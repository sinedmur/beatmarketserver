const express = require('express');
const { MongoClient, ObjectId } = require('mongodb'); // Добавлен ObjectId
const multer = require('multer');
const path = require('path');
const cors = require('cors'); // Добавлен cors
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer Configuration
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (_, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Routes
app.get('/beats', async (req, res) => {
  try {
    const beats = await db.collection('beats').find().toArray();
    res.json(beats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/upload', upload.fields([{ name: 'cover' }, { name: 'audio' }]), async (req, res) => {
  try {
    if (!req.files?.cover || !req.files?.audio) {
      return res.status(400).json({ error: 'Both cover and audio files are required' });
    }

    const baseUrl = `https://${req.get('host')}`;
    const newBeat = {
      title: req.body.title,
      genre: req.body.genre,
      bpm: parseInt(req.body.bpm),
      price: parseFloat(req.body.price),
      artist: req.body.artist,
      cover: `${baseUrl}/uploads/${req.files.cover[0].filename}`,
      audio: `${baseUrl}/uploads/${req.files.audio[0].filename}`,
      uploadDate: new Date(),
      sales: 0,
      earned: 0
    };

    const result = await db.collection('beats').insertOne(newBeat);
    res.json({ success: true, beat: { _id: result.insertedId, ...newBeat } });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
      user = { telegramId: req.params.id, balance: 0, purchases: [] };
    }

    // Если нужно получить информацию о покупках
    if (user.purchases && user.purchases.length > 0) {
      const purchases = await db.collection('beats').find({
        _id: { $in: user.purchases.map(id => new ObjectId(id)) }
      }).toArray();
      user.purchases = purchases;
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
