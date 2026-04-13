import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';

const router = Router();

interface Execution {
  id: string;
  binary_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  exit_code: number | null;
  started_at: string | null;
  completed_at: string | null;
  args: string;
}

const executions = new Map<string, Execution>();

router.post('/', async (req, res) => {
  const { binaryId, args = [], captureOutput = true, timeout = 60000, background = false } = req.body;

  if (!binaryId) {
    return res.status(400).json({ error: 'binaryId is required' });
  }

  try {
    const binary = db.prepare('SELECT * FROM binaries WHERE id = ?').get(binaryId) as any;
    
    if (!binary) {
      return res.status(404).json({ error: 'Binary not found' });
    }

    const executionId = uuidv4();
    const execution: Execution = {
      id: executionId,
      binary_id: binaryId,
      status: 'pending',
      output: '',
      exit_code: null,
      started_at: null,
      completed_at: null,
      args: args.join(' ')
    };

    executions.set(executionId, execution);

    db.prepare(`
      INSERT INTO executions (id, binary_id, status, output, exit_code, started_at, completed_at, args)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      executionId,
      binaryId,
      execution.status,
      execution.output,
      execution.exit_code,
      execution.started_at,
      execution.completed_at,
      execution.args
    );

    if (background) {
      executeBinaryAsync(executionId, binary, args);
      res.status(202).json({ executionId, status: 'pending' });
    } else {
      const result = await executeBinarySync(executionId, binary, args, timeout);
      res.json(result);
    }
  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({ error: 'Execution failed' });
  }
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const execution = executions.get(id);

  if (!execution) {
    const dbExecution = db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as any;
    if (!dbExecution) {
      return res.status(404).json({ error: 'Execution not found' });
    }
    return res.json(dbExecution);
  }

  res.json(execution);
});

router.post('/:id/cancel', (req, res) => {
  const { id } = req.params;
  const execution = executions.get(id);

  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }

  if (execution.status !== 'running') {
    return res.status(400).json({ error: 'Execution not running' });
  }

  execution.status = 'cancelled';
  execution.completed_at = new Date().toISOString();

  db.prepare(`
    UPDATE executions SET status = ?, completed_at = ? WHERE id = ?
  `).run(execution.status, execution.completed_at, id);

  res.json({ message: 'Execution cancelled' });
});

async function executeBinarySync(
  executionId: string, 
  binary: any, 
  args: string[], 
  timeout: number
): Promise<any> {
  const execution = executions.get(executionId)!;
  
  execution.status = 'running';
  execution.started_at = new Date().toISOString();
  
  db.prepare(`
    UPDATE executions SET status = ?, started_at = ? WHERE id = ?
  `).run(execution.status, execution.started_at, executionId);

  return new Promise((resolve) => {
    const startTime = Date.now();
    let output = '';
    
    const interval = setInterval(() => {
      if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        execution.status = 'failed';
        execution.output = 'Execution timeout';
        execution.exit_code = -1;
        execution.completed_at = new Date().toISOString();
        
        db.prepare(`
          UPDATE executions SET status = ?, output = ?, exit_code = ?, completed_at = ?
          WHERE id = ?
        `).run(
          execution.status,
          execution.output,
          execution.exit_code,
          execution.completed_at,
          executionId
        );
        
        resolve({
          success: false,
          output: execution.output,
          exitCode: execution.exit_code,
          duration: timeout
        });
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(interval);
      
      execution.status = 'completed';
      execution.output = `Binary executed: ${binary.name} ${args.join(' ')}`;
      execution.exit_code = 0;
      execution.completed_at = new Date().toISOString();
      
      db.prepare(`
        UPDATE executions SET status = ?, output = ?, exit_code = ?, completed_at = ?
        WHERE id = ?
      `).run(
        execution.status,
        execution.output,
        execution.exit_code,
        execution.completed_at,
        executionId
      );
      
      const duration = Date.now() - startTime;
      
      resolve({
        success: true,
        output: execution.output,
        exitCode: 0,
        duration
      });
    }, Math.min(timeout, 5000));
  });
}

function executeBinaryAsync(
  executionId: string, 
  binary: any, 
  args: string[]
): void {
  const execution = executions.get(executionId)!;
  
  execution.status = 'running';
  execution.started_at = new Date().toISOString();
  
  db.prepare(`
    UPDATE executions SET status = ?, started_at = ? WHERE id = ?
  `).run(execution.status, execution.started_at, executionId);

  setTimeout(() => {
    execution.status = 'completed';
    execution.output = `Background: ${binary.name} ${args.join(' ')}`;
    execution.exit_code = 0;
    execution.completed_at = new Date().toISOString();
    
    db.prepare(`
      UPDATE executions SET status = ?, output = ?, exit_code = ?, completed_at = ?
      WHERE id = ?
    `).run(
      execution.status,
      execution.output,
      execution.exit_code,
      execution.completed_at,
      executionId
    );
  }, 2000);
}

export default router;