const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier'); // Для загрузки буферов в Cloudinary
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
    console.log('Successfully connected to MongoDB');
    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// Middleware для проверки подключения к DB
app.use(async (req, res, next) => {
  if (!db) {
    try {
      await initDB();
      next();
    } catch (err) {
      res.status(500).json({ error: 'Database connection failed' });
    }
  } else {
    next();
  }
});

// Middleware
app.use(cors({
  origin: ['https://sinedmur.github.io', 'https://127.0.0.1:5500'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Настройка Multer для обработки файлов в памяти (без сохранения на диск)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB (увеличьте при необходимости)
  }
});

// Функция для загрузки в Cloudinary
const uploadToCloudinary = (fileBuffer, folder, resourceType = 'image') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `beatmarket/${folder}`,
        resource_type: resourceType
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    
    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

// Routes
app.get('/beats', async (req, res) => {
  try {
    const { producer } = req.query;
    let query = {};
    
    if (producer) {
      query.ownerTelegramId = producer;
    }
    
    const beats = await db.collection('beats').find(query).toArray();
    
    // Преобразуем _id в строку
    const formattedBeats = beats.map(beat => ({
      ...beat,
      _id: beat._id.toString(),
      id: beat._id.toString()
    }));
    
    res.json(formattedBeats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/producers', async (req, res) => {
  try {
    // Получаем всех пользователей, у которых есть биты
    const producers = await db.collection('beats').aggregate([
      {
        $group: {
          _id: "$ownerTelegramId",
          beats: { $push: "$$ROOT" }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "telegramId",
          as: "userInfo"
        }
      },
      {
        $unwind: "$userInfo"
      },
      {
        $project: {
          id: { $toString: "$_id" },
          name: "$userInfo.username",
          avatar: "$userInfo.photo_url",
          beats: "$beats._id",
          followers: { $size: "$userInfo.followers" || [] }
        }
      }
    ]).toArray();

    res.json(producers);
  } catch (error) {
    console.error('Error fetching producers:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/producer/:id', async (req, res) => {
  try {
    const producerId = req.params.id;
    
    // Ищем продюсера
    const producer = await db.collection('users').findOne(
      { telegramId: producerId },
      { projection: { username: 1, photo_url: 1, followers: 1 } }
    );
    
    if (!producer) {
      return res.status(404).json({ error: 'Producer not found' });
    }
    
    // Получаем биты продюсера
    const beats = await db.collection('beats').find(
      { ownerTelegramId: producerId },
      { projection: { _id: 1 } }
    ).toArray();
    
    res.json({
      id: producerId,
      name: producer.username || 'Unknown',
      avatar: producer.photo_url,
      beats: beats.map(b => b._id),
      followers: producer.followers?.length || 0
    });
  } catch (error) {
    console.error('Error fetching producer:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/follow', async (req, res) => {
  try {
    const { userId, producerId } = req.body;
    
    // Проверяем, что пользователь не подписывается на себя
    if (userId === producerId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    
    // Добавляем подписку
    await db.collection('users').updateOne(
      { telegramId: producerId },
      { $addToSet: { followers: userId } }
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload', upload.fields([{ name: 'cover' }, { name: 'audio' }]), async (req, res) => {
  try {
    if (!req.files?.cover || !req.files?.audio) {
      return res.status(400).json({ error: 'Both cover and audio files are required' });
    }

    // Загружаем обложку в Cloudinary
    const coverResult = await uploadToCloudinary(
      req.files.cover[0].buffer,
      'covers',
      'image'
    );

    // Загружаем аудио в Cloudinary
    const audioResult = await uploadToCloudinary(
      req.files.audio[0].buffer,
      'audio',
      'video' // Cloudinary обрабатывает аудио как видео
    );

    const newBeat = {
      title: req.body.title,
      genre: req.body.genre,
      bpm: parseInt(req.body.bpm),
      price: parseFloat(req.body.price),
      artist: req.body.artist,
      cover: coverResult.secure_url,
      audio: audioResult.secure_url,
      uploadDate: new Date(),
      sales: 0,
      earned: 0,
      ownerTelegramId: req.body.ownerTelegramId, // <= добавить это
      cloudinary: {
        cover_public_id: coverResult.public_id,
        audio_public_id: audioResult.public_id
      }
    };

    const result = await db.collection('beats').insertOne(newBeat);
    res.json({ 
      success: true, 
      beat: { 
        _id: result.insertedId, 
        ...newBeat 
      } 
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
});

app.post('/favorite', async (req, res) => {
  const { userId, beatId, action } = req.body;

  if (!userId || !beatId || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const update =
    action === 'add'
      ? { $addToSet: { favorites: new ObjectId(beatId) } }
      : { $pull: { favorites: new ObjectId(beatId) } };

  await db.collection('users').updateOne(
    { telegramId: userId },
    update,
    { upsert: true }
  );

  res.json({ success: true });
});

app.delete('/beat/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid beat ID' });
    }

    // Проверяем, что бит принадлежит пользователю
    const beat = await db.collection('beats').findOne({ 
      _id: new ObjectId(id),
      ownerTelegramId: userId
    });

    if (!beat) {
      return res.status(404).json({ 
        error: 'Beat not found or you are not the owner' 
      });
    }

    // Удаляем из Cloudinary (если нужно)
    if (beat.cloudinary?.audio_public_id) {
      await cloudinary.uploader.destroy(beat.cloudinary.audio_public_id, {
        resource_type: 'video'
      });
    }

    if (beat.cloudinary?.cover_public_id) {
      await cloudinary.uploader.destroy(beat.cloudinary.cover_public_id);
    }

    // Удаляем из базы данных
    await db.collection('beats').deleteOne({ _id: new ObjectId(id) });

    // Удаляем из избранного пользователей
    await db.collection('users').updateMany(
      { favorites: new ObjectId(id) },
      { $pull: { favorites: new ObjectId(id) } }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete beat error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/purchase', async (req, res) => {
  try {
    const { userId, beatId } = req.body;
    
    // Используем db.collection вместо Mongoose моделей
    const beat = await db.collection('beats').findOne({ _id: new ObjectId(beatId) });
    if (!beat) return res.status(404).json({ error: 'Beat not found' });

    let user = await db.collection('users').findOne({ telegramId: userId });
    if (!user) {
      user = { telegramId: userId, balance: 0, purchases: [] };
      await db.collection('users').insertOne(user);
    }

    if (!user.purchases.includes(new ObjectId(beatId))) {
      await db.collection('users').updateOne(
        { telegramId: userId },
        { $push: { purchases: new ObjectId(beatId) } }
      );
      
      await db.collection('beats').updateOne(
        { _id: new ObjectId(beatId) },
        { $inc: { sales: 1, earned: beat.price } }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/user/:id', async (req, res) => {
  try {
    let user = await db.collection('users').findOne({ telegramId: req.params.id });

    if (!user) {
      user = { telegramId: req.params.id, balance: 0, purchases: [], favorites: [] };
    }

    // Получаем покупки
    if (user.purchases && user.purchases.length > 0) {
      const purchases = await db.collection('beats').find({
        _id: { $in: user.purchases.map(id => new ObjectId(id)) }
      }).toArray();
      user.purchases = purchases;
    }

    // Получаем избранное
    if (user.favorites && user.favorites.length > 0) {
      const favorites = await db.collection('beats').find({
        _id: { $in: user.favorites.map(id => new ObjectId(id)) }
      }).toArray();
      user.favorites = favorites;
    }

    res.json(user);
  } catch (error) {
    console.error('User error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Запуск сервера
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
