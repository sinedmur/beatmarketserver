const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

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
}));

// Измените путь к файлу БД на абсолютный
const dbFile = path.join(__dirname, 'db.json');

// Добавьте проверку при старте сервера
if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, JSON.stringify({ beats: [], users: [] }));
  console.log('Created new DB file');
} else {
  console.log('Existing DB file loaded:', JSON.parse(fs.readFileSync(dbFile)));
}

function readDB() {
  return JSON.parse(fs.readFileSync(dbFile));
}

// При изменении данных пишем в db.json и пушим в Git
function writeDB(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data));
  exec('git add db.json && git commit -m "Update DB" && git push');
}

const storage = multer.diskStorage({
  destination: './uploads',
  filename: (_, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

app.get('/beats', (req, res) => {
  const db = readDB();
  res.json(db.beats);
});

app.post('/upload', upload.fields([{ name: 'cover' }, { name: 'audio' }]), (req, res) => {
  try {
    console.log('FILES RECEIVED:', req.files);
    console.log('BODY RECEIVED:', req.body);
    
    if (!req.files?.cover || !req.files?.audio) {
      return res.status(400).json({ error: 'Both cover and audio files are required' });
    }

    const db = readDB();
    const baseUrl = `https://${req.get('host')}`;
    
    const newBeat = {
      id: Date.now().toString(),
      title: req.body.title,
      genre: req.body.genre,
      bpm: Number(req.body.bpm),
      price: Number(req.body.price),
      artist: req.body.artist,
      cover: `${baseUrl}/uploads/${req.files.cover[0].filename}`,
      audio: `${baseUrl}/uploads/${req.files.audio[0].filename}`,
      uploadDate: new Date().toISOString(),
      sales: 0,
      earned: 0
    };
    
    db.beats.push(newBeat);
    writeDB(db);
    res.json({ success: true, beat: newBeat });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ... остальные обработчики ...

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server started on https://beatmarketserver.onrender.com:${PORT}`);
});
