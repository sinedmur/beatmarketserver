const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/beatmarket', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Схемы Mongoose
const BeatSchema = new mongoose.Schema({
  title: { type: String, required: true },
  genre: { type: String, required: true },
  bpm: { type: Number, required: true },
  price: { type: Number, required: true },
  artist: { type: String, required: true },
  cover: { type: String, required: true },
  audio: { type: String, required: true },
  uploadDate: { type: Date, default: Date.now },
  sales: { type: Number, default: 0 },
  earned: { type: Number, default: 0 }
});

const UserSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  balance: { type: Number, default: 0 },
  purchases: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Beat' }]
});

const Beat = mongoose.model('Beat', BeatSchema);
const User = mongoose.model('User', UserSchema);

// Middleware
app.use(cors({
  origin: ['https://sinedmur.github.io', 'https://127.0.0.1:5500'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
});

// Настройка Multer для загрузки файлов
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (_, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Роуты
app.get('/beats', async (req, res) => {
  try {
    const beats = await Beat.find();
    res.json(beats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload', upload.fields([{ name: 'cover' }, { name: 'audio' }]), async (req, res) => {
  try {
    if (!req.files?.cover || !req.files?.audio) {
      return res.status(400).json({ error: 'Both cover and audio files are required' });
    }

    const baseUrl = `https://${req.get('host')}`;
    
    const newBeat = new Beat({
      title: req.body.title,
      genre: req.body.genre,
      bpm: Number(req.body.bpm),
      price: Number(req.body.price),
      artist: req.body.artist,
      cover: `${baseUrl}/uploads/${req.files.cover[0].filename}`,
      audio: `${baseUrl}/uploads/${req.files.audio[0].filename}`
    });

    await newBeat.save();
    res.json({ success: true, beat: newBeat });
  } catch (error) {
    console.error('Upload error:', error);
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
