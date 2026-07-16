const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { pricePerLiter: 0, readings: [], billing: {}, nextId: 1 };
  const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8').replace(/^﻿/, ''));
  if (!d.billing) d.billing = {};
  if (!d.nextId) d.nextId = 1;
  // give every reading a permanent id (used for edit/delete)
  let changed = false;
  for (const r of d.readings) if (!r.id) { r.id = d.nextId++; changed = true; }
  if (changed) saveData(d);
  return d;
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.get('/exifr.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'exifr', 'dist', 'lite.umd.js'))
);

// Get all data
app.get('/api/data', (req, res) => {
  res.json(loadData());
});

// Save/update price per liter
app.post('/api/price', (req, res) => {
  const data = loadData();
  data.pricePerLiter = Number(req.body.pricePerLiter) || 0;
  saveData(data);
  res.json({ ok: true, pricePerLiter: data.pricePerLiter });
});

// Save month bills: { month, manjeeraAmount, tankerAmount, rebates }
// rebates = { "101": 20000, ... } — free litres per flat (deducted from
// consumption); remaining litres of all flats share the total amount.
app.post('/api/billing', (req, res) => {
  const { month, manjeeraAmount, tankerAmount, totalInputLitres, rebates, brokenMeters } = req.body;
  if (!month) return res.status(400).json({ ok: false, error: 'month required' });
  const data = loadData();
  const cleanRebates = {};
  if (rebates && typeof rebates === 'object') {
    for (const [flat, litres] of Object.entries(rebates)) {
      const n = Number(litres);
      if (!isNaN(n) && n > 0) cleanRebates[String(flat)] = n;
    }
  }
  const cleanBroken = {};
  if (brokenMeters && typeof brokenMeters === 'object') {
    for (const flat of Object.keys(brokenMeters)) if (brokenMeters[flat]) cleanBroken[String(flat)] = true;
  }
  data.billing[month] = {
    manjeeraAmount: Number(manjeeraAmount) || 0,
    tankerAmount: Number(tankerAmount) || 0,
    totalInputLitres: Number(totalInputLitres) || 0,
    rebates: cleanRebates,
    brokenMeters: cleanBroken,
    inputs: (req.body.inputs && typeof req.body.inputs === 'object') ? req.body.inputs : {}
  };
  saveData(data);
  res.json({ ok: true });
});

// Upload photos (multiple). Returns saved file names so the UI can
// show them next to flat/reading inputs.
app.post('/api/upload', upload.array('photos', 50), (req, res) => {
  const files = (req.files || []).map(f => f.filename);
  res.json({ ok: true, files });
});

// Save readings entered for the uploaded photos.
// Body: { month: "2026-07", entries: [{flat, reading, photo}] }
// Same flat + same month => update (latest reading wins).
app.post('/api/readings', (req, res) => {
  const { month, entries } = req.body;
  if (!month || !Array.isArray(entries)) {
    return res.status(400).json({ ok: false, error: 'month and entries required' });
  }
  const data = loadData();
  for (const e of entries) {
    const flat = String(e.flat || '').trim();
    const reading = Number(e.reading);
    if (!flat || isNaN(reading)) continue;
    // Multiple readings per flat per month are kept (first = start, last = end).
    // Only an entry for the SAME photo is updated instead of duplicated.
    const existing = e.photo
      ? data.readings.find(r => r.flat === flat && r.month === month && r.photo === e.photo)
      : null;
    if (existing) {
      existing.reading = reading;
      if (e.takenAt) existing.takenAt = e.takenAt;
      existing.updatedAt = new Date().toISOString();
    } else {
      data.readings.push({
        id: data.nextId++,
        flat, month, reading,
        photo: e.photo || null,
        takenAt: e.takenAt || null,
        updatedAt: new Date().toISOString()
      });
    }
  }
  saveData(data);
  res.json({ ok: true });
});

// Edit one reading by id: { id, reading, takenAt? }
app.post('/api/reading/update', (req, res) => {
  const { id, reading, takenAt } = req.body;
  const data = loadData();
  const r = data.readings.find(x => x.id === Number(id));
  if (!r) return res.status(404).json({ ok: false, error: 'not found' });
  const n = Number(reading);
  if (!isNaN(n)) r.reading = n;
  if (takenAt) r.takenAt = takenAt;
  r.updatedAt = new Date().toISOString();
  saveData(data);
  res.json({ ok: true });
});

// Delete one reading by id
app.post('/api/reading/delete', (req, res) => {
  const data = loadData();
  data.readings = data.readings.filter(r => r.id !== Number(req.body.id));
  saveData(data);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`SKS Water Meters running at http://localhost:${PORT}`);
});
