
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dbFile = './db.json';
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ beats: [], users: [] }));

function readDB() {
  return JSON.parse(fs.readFileSync(dbFile));
}

function writeDB(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
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
  console.log('FILES RECEIVED:', req.files);
  console.log('BODY RECEIVED:', req.body);
  const db = readDB();
  const newBeat = {
    id: Date.now().toString(),
    title: req.body.title,
    genre: req.body.genre,
    bpm: Number(req.body.bpm),
    price: Number(req.body.price),
    artist: req.body.artist,
    cover: `/uploads/${req.files.cover[0].filename}`,
    audio: `/uploads/${req.files.audio[0].filename}`,
    uploadDate: new Date().toISOString(),
    sales: 0,
    earned: 0
  };
  db.beats.push(newBeat);
  writeDB(db);
  res.json({ success: true, beat: newBeat });
});

app.post('/purchase', (req, res) => {
  const { userId, beatId } = req.body;
  const db = readDB();

  const beat = db.beats.find(b => b.id === beatId);
  if (!beat) return res.status(404).json({ error: 'Beat not found' });

  const user = db.users.find(u => u.id === userId) || { id: userId, balance: 0, purchases: [] };
  if (!user.purchases.includes(beatId)) {
    user.purchases.push(beatId);
    beat.sales++;
    beat.earned += beat.price;
  }

  if (!db.users.find(u => u.id === userId)) db.users.push(user);
  writeDB(db);
  res.json({ success: true });
});

app.get('/user/:id', (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id) || { id: req.params.id, balance: 0, purchases: [] };
  res.json(user);
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
