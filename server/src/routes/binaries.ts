import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../../uploads/binaries');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

/**
 * GET /api/binaries
 * List all binaries stored in the database
 */
router.get('/', (req, res) => {
  try {
    const binaries = db.prepare('SELECT * FROM binaries ORDER BY uploaded_at DESC').all();
    res.json(binaries);
  } catch (error) {
    console.error('Failed to fetch binaries:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/binaries/upload
 * Upload a new binary file
 */
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { originalname, size, filename } = req.file;
  const ext = originalname.split('.').pop()?.toLowerCase() || 'unknown';
  
  let type = 'unknown';
  if (ext === 'appimage') type = 'appimage';
  else if (ext === 'deb') type = 'deb';
  else if (ext === 'rpm') type = 'rpm';

  const binary = {
    id: uuidv4(),
    name: originalname,
    size: size,
    type: type,
    uploaded_at: new Date().toISOString(),
    status: 'pending',
    path: `/uploads/binaries/${filename}`
  };

  try {
    const insert = db.prepare(`
      INSERT INTO binaries (id, name, size, type, uploaded_at, status, path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    insert.run(
      binary.id,
      binary.name,
      binary.size,
      binary.type,
      binary.uploaded_at,
      binary.status,
      binary.path
    );

    res.status(201).json(binary);
  } catch (error) {
    console.error('Failed to save binary to database:', error);
    res.status(500).json({ error: 'Failed to save binary metadata' });
  }
});

/**
 * DELETE /api/binaries/:id
 * Delete a binary from the system
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const binary = db.prepare('SELECT * FROM binaries WHERE id = ?').get() as any;
    
    if (!binary) {
      return res.status(404).json({ error: 'Binary not found' });
    }

    // Delete file from disk
    const filePath = path.join(__dirname, '../../../', binary.path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    db.prepare('DELETE FROM binaries WHERE id = ?').run(id);

    res.json({ message: 'Binary deleted successfully' });
  } catch (error) {
    console.error('Failed to delete binary:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
