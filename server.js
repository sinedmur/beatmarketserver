const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db('BeatMarket');
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

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
    
    const beat = await Beat.findById(beatId);
    if (!beat) return res.status(404).json({ error: 'Beat not found' });

    let user = await User.findOne({ telegramId: userId });
    if (!user) {
      user = new User({ telegramId: userId });
    }

    if (!user.purchases.includes(beatId)) {
      user.purchases.push(beatId);
      beat.sales += 1;
      beat.earned += beat.price;
      await Promise.all([user.save(), beat.save()]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/user/:id', async (req, res) => {
  try {
    let user = await User.findOne({ telegramId: req.params.id })
      .populate('purchases');
    
    if (!user) {
      user = { telegramId: req.params.id, balance: 0, purchases: [] };
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
