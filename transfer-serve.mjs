import { createServer } from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const PORT = 9999;
const ROOT = dirname(fileURLToPath(import.meta.url));

createServer((req, res) => {
  const ip = req.socket.remoteAddress;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${ip}`);

  if (req.url === '/test') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`OK from ${ip}\nServer time: ${new Date().toISOString()}\n`);
    return;
  }

  if (req.url === '/data.tar.gz') {
    try {
      const tar = execSync('tar czf - data/ reports/', { cwd: ROOT, maxBuffer: 50 * 1024 * 1024 });
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="career-ops-data.tar.gz"',
        'Content-Length': tar.length,
      });
      res.end(tar);
      console.log(`  -> served ${tar.length} bytes`);
    } catch (e) {
      res.writeHead(500);
      res.end('tar failed: ' + e.message);
    }
    return;
  }

  if (req.url === '/' || req.url === '/list') {
    const listing = execSync('find data/ reports/ -type f | sort', { cwd: ROOT }).toString();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Career-Ops Data Transfer Server\n=============================\n\nEndpoints:\n  GET /test       - connectivity test\n  GET /data.tar.gz - download tarball (~1.2MB compressed)\n  GET /list       - file listing\n\nFiles in bundle:\n${listing}\n`);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, '::', () => {
  console.log(`Server listening on http://[::]:${PORT}`);
  console.log(`Also on http://0.0.0.0:${PORT}`);
});
