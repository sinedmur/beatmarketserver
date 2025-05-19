const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Конфигурация Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Глобальное подключение к DB
let db;
let client;

async function initDB() {
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('beatmarket');
    
    // Создаем индексы для оптимизации
    await db.collection('beats').createIndex({ ownerTelegramId: 1 });
    await db.collection('users').createIndex({ telegramId: 1 });
    await db.collection('users').createIndex({ followers: 1 });
    await db.collection('users').createIndex({ favorites: 1 });
    await db.collection('users').createIndex({ purchases: 1 });
    
    console.log('Successfully connected to MongoDB with indexes');
    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// Middleware
app.use(async (req, res, next) => {
  if (!db) {
    try {
      await initDB();
      next();
    } catch (err) {
      console.error('Database connection failed:', err);
      res.status(500).json({ error: 'Database connection failed' });
    }
  } else {
    next();
  }
});

app.use(cors({
  origin: ['https://sinedmur.github.io', 'https://127.0.0.1:5500'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Настройка Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Вспомогательные функции
const uploadToCloudinary = (fileBuffer, folder, resourceType = 'image') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: `beatmarket/${folder}`, resource_type: resourceType },
      (error, result) => error ? reject(error) : resolve(result)
    );
    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

const validateObjectId = (id) => {
  if (!id || !ObjectId.isValid(id)) {
    throw new Error('Invalid ID format');
  }
};

// Routes
/**
 * @swagger
 * /beats:
 *   get:
 *     summary: Get all beats or beats by producer
 *     parameters:
 *       - in: query
 *         name: producer
 *         schema:
 *           type: string
 *         description: Producer ID to filter beats
 *     responses:
 *       200:
 *         description: List of beats
 */
app.get('/beats', async (req, res) => {
  try {
    const { producer } = req.query;
    let query = {};
    
    if (producer) {
      query.ownerTelegramId = producer;
    }
    
    const beats = await db.collection('beats').find(query).toArray();
    const formattedBeats = beats.map(beat => ({
      ...beat,
      _id: beat._id.toString(),
      id: beat._id.toString()
    }));
    
    res.json(formattedBeats);
  } catch (err) {
    console.error('GET /beats error:', err);
    res.status(500).json({ error: 'Failed to get beats' });
  }
});

/**
 * @swagger
 * /producers:
 *   get:
 *     summary: Get all producers with their beats
 *     responses:
 *       200:
 *         description: List of producers
 */
app.get('/producers', async (req, res) => {
  try {
    const producers = await db.collection('beats').aggregate([
      { $group: { _id: "$ownerTelegramId", beats: { $push: "$$ROOT" } } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "telegramId",
          as: "userInfo"
        }
      },
      { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          id: { $toString: "$_id" },
          name: { $ifNull: ["$userInfo.username", "Unknown"] },
          avatar: { $ifNull: ["$userInfo.photo_url", "https://via.placeholder.com/150"] },
          beats: "$beats._id",
          followers: { $size: { $ifNull: ["$userInfo.followers", []] } }
        }
      }
    ]).toArray();

    res.json(producers);
  } catch (error) {
    console.error('GET /producers error:', error);
    res.status(500).json({ error: 'Failed to get producers' });
  }
});

/**
 * @swagger
 * /producer/{id}:
 *   get:
 *     summary: Get producer details by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Producer details
 *       404:
 *         description: Producer not found
 */
app.get('/producer/:id', async (req, res) => {
  try {
    const producerId = req.params.id;
    if (!producerId) return res.status(400).json({ error: 'Producer ID is required' });

    const result = await db.collection('users').aggregate([
      { $match: { telegramId: producerId } },
      {
        $lookup: {
          from: "beats",
          localField: "telegramId",
          foreignField: "ownerTelegramId",
          as: "beats"
        }
      },
      {
        $project: {
          id: "$telegramId",
          name: { $ifNull: ["$username", "Unknown"] },
          avatar: { $ifNull: ["$photo_url", "https://via.placeholder.com/150"] },
          beats: "$beats._id",
          followers: { $size: { $ifNull: ["$followers", []] } }
        }
      }
    ]).next();

    if (!result) return res.status(404).json({ error: 'Producer not found' });
    res.json(result);
  } catch (error) {
    console.error('GET /producer/:id error:', error);
    res.status(500).json({ error: 'Failed to get producer' });
  }
});

/**
 * @swagger
 * /follow:
 *   post:
 *     summary: Follow a producer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               producerId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully followed
 *       400:
 *         description: Cannot follow yourself
 */
app.post('/follow', async (req, res) => {
  try {
    const { userId, producerId } = req.body;
    if (!userId || !producerId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (userId === producerId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    // Проверяем существование пользователя и продюсера
    const [user, producer] = await Promise.all([
      db.collection('users').findOne({ telegramId: userId }),
      db.collection('users').findOne({ telegramId: producerId })
    ]);

    if (!user || !producer) {
      return res.status(404).json({ error: 'User or producer not found' });
    }

    await db.collection('users').updateOne(
      { telegramId: producerId },
      { $addToSet: { followers: userId } }
    );

    console.log(`User ${userId} followed producer ${producerId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('POST /follow error:', error);
    res.status(500).json({ error: 'Failed to follow producer' });
  }
});

/**
 * @swagger
 * /upload:
 *   post:
 *     summary: Upload a new beat
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               genre:
 *                 type: string
 *               bpm:
 *                 type: number
 *               price:
 *                 type: number
 *               artist:
 *                 type: string
 *               ownerTelegramId:
 *                 type: string
 *               cover:
 *                 type: string
 *                 format: binary
 *               audio:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Beat uploaded successfully
 */
app.post('/upload', upload.fields([{ name: 'cover' }, { name: 'audio' }]), async (req, res) => {
  try {
    if (!req.files?.cover || !req.files?.audio) {
      return res.status(400).json({ error: 'Both cover and audio files are required' });
    }

    const { title, genre, bpm, price, artist, ownerTelegramId } = req.body;
    if (!title || !genre || !bpm || !price || !ownerTelegramId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const [coverResult, audioResult] = await Promise.all([
      uploadToCloudinary(req.files.cover[0].buffer, 'covers', 'image'),
      uploadToCloudinary(req.files.audio[0].buffer, 'audio', 'video')
    ]);

    const newBeat = {
      title,
      genre,
      bpm: parseInt(bpm),
      price: parseFloat(price),
      artist: artist || 'Unknown',
      cover: coverResult.secure_url,
      audio: audioResult.secure_url,
      uploadDate: new Date(),
      sales: 0,
      earned: 0,
      ownerTelegramId,
      cloudinary: {
        cover_public_id: coverResult.public_id,
        audio_public_id: audioResult.public_id
      }
    };

    const result = await db.collection('beats').insertOne(newBeat);
    
    // Обновляем информацию о продюсере
    await db.collection('users').updateOne(
      { telegramId: ownerTelegramId },
      { $setOnInsert: { telegramId: ownerTelegramId, username: artist } },
      { upsert: true }
    );

    console.log(`New beat uploaded by ${ownerTelegramId}: ${title}`);
    res.json({ 
      success: true, 
      beat: { 
        _id: result.insertedId.toString(), 
        ...newBeat 
      } 
    });
  } catch (err) {
    console.error('POST /upload error:', err);
    res.status(500).json({ error: 'Failed to upload beat' });
  }
});

/**
 * @swagger
 * /favorite:
 *   post:
 *     summary: Add/remove beat from favorites
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               beatId:
 *                 type: string
 *               action:
 *                 type: string
 *                 enum: [add, remove]
 *     responses:
 *       200:
 *         description: Favorites updated
 */
app.post('/favorite', async (req, res) => {
  try {
    const { userId, beatId, action } = req.body;
    if (!userId || !beatId || !['add', 'remove'].includes(action)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    validateObjectId(beatId);

    const update = action === 'add' 
      ? { $addToSet: { favorites: new ObjectId(beatId) } } 
      : { $pull: { favorites: new ObjectId(beatId) } };

    await db.collection('users').updateOne(
      { telegramId: userId },
      update,
      { upsert: true }
    );

    console.log(`User ${userId} ${action === 'add' ? 'added' : 'removed'} beat ${beatId} to favorites`);
    res.json({ success: true });
  } catch (error) {
    console.error('POST /favorite error:', error);
    res.status(500).json({ error: 'Failed to update favorites' });
  }
});

/**
 * @swagger
 * /beat/{id}:
 *   delete:
 *     summary: Delete a beat
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Beat deleted
 *       403:
 *         description: Not the owner
 */
app.delete('/beat/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    validateObjectId(id);
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    const beat = await db.collection('beats').findOne({ 
      _id: new ObjectId(id),
      ownerTelegramId: userId
    });

    if (!beat) {
      return res.status(403).json({ 
        error: 'Beat not found or you are not the owner' 
      });
    }

    // Удаляем файлы из Cloudinary
    await Promise.all([
      beat.cloudinary?.audio_public_id 
        ? cloudinary.uploader.destroy(beat.cloudinary.audio_public_id, { resource_type: 'video' }) 
        : Promise.resolve(),
      beat.cloudinary?.cover_public_id 
        ? cloudinary.uploader.destroy(beat.cloudinary.cover_public_id) 
        : Promise.resolve()
    ]);

    // Удаляем из базы
    await db.collection('beats').deleteOne({ _id: new ObjectId(id) });

    // Удаляем из избранного пользователей
    await db.collection('users').updateMany(
      { favorites: new ObjectId(id) },
      { $pull: { favorites: new ObjectId(id) } }
    );

    console.log(`Beat ${id} deleted by user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /beat/:id error:', error);
    res.status(500).json({ error: 'Failed to delete beat' });
  }
});

/**
 * @swagger
 * /purchase:
 *   post:
 *     summary: Purchase a beat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               beatId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Purchase successful
 */
app.post('/purchase', async (req, res) => {
  try {
    const { userId, beatId } = req.body;
    if (!userId || !beatId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    validateObjectId(beatId);

    const [beat, user] = await Promise.all([
      db.collection('beats').findOne({ _id: new ObjectId(beatId) }),
      db.collection('users').findOne({ telegramId: userId }) || 
        db.collection('users').insertOne({ 
          telegramId: userId, 
          balance: 0, 
          purchases: [] 
        }).then(() => ({ telegramId: userId, purchases: [] }))
    ]);

    if (!beat) return res.status(404).json({ error: 'Beat not found' });

    if (!user.purchases.some(p => p.equals(new ObjectId(beatId)))) {
      await Promise.all([
        db.collection('users').updateOne(
          { telegramId: userId },
          { $addToSet: { purchases: new ObjectId(beatId) } }
        ),
        db.collection('beats').updateOne(
          { _id: new ObjectId(beatId) },
          { $inc: { sales: 1, earned: beat.price } }
        )
      ]);
    }

    console.log(`User ${userId} purchased beat ${beatId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('POST /purchase error:', error);
    res.status(500).json({ error: 'Failed to process purchase' });
  }
});

/**
 * @swagger
 * /user/{id}:
 *   get:
 *     summary: Get user details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details
 */
app.get('/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    const user = await db.collection('users').findOne({ telegramId: userId }) || {
      telegramId: userId,
      balance: 0,
      purchases: [],
      favorites: []
    };

    // Получаем полную информацию о покупках и избранном
    const [purchases, favorites] = await Promise.all([
      user.purchases?.length 
        ? db.collection('beats').find({ 
            _id: { $in: user.purchases } 
          }).toArray() 
        : [],
      user.favorites?.length 
        ? db.collection('beats').find({ 
            _id: { $in: user.favorites } 
          }).toArray() 
        : []
    ]);

    res.json({
      ...user,
      purchases: purchases.map(b => ({ ...b, _id: b._id.toString() })),
      favorites: favorites.map(b => ({ ...b, _id: b._id.toString() }))
    });
  } catch (error) {
    console.error('GET /user/:id error:', error);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Запуск сервера
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
