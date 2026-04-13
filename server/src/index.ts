import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import binariesRouter from './routes/binaries.js';
import executeRouter from './routes/execute.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure directories exist
const UPLOADS_DIR = path.join(__dirname, '../../uploads/binaries');
const PUBLIC_V86_DIR = path.join(__dirname, '../../../public/v86');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Routes
app.use('/api/binaries', binariesRouter);
app.use('/api/execute', executeRouter);

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
app.use('/v86/assets', express.static(PUBLIC_V86_DIR));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'TRYMON BINARY ENGINE' });
});

app.listen(PORT, () => {
  console.log(`TRYMON Backend running on http://localhost:${PORT}`);
});
