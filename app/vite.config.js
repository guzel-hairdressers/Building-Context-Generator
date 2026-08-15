import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { exec, spawn } from 'child_process';

const fetchPlugin = () => ({
  name: 'fetch-custom-site-api',
  configureServer(server) {
    const handleFetchRequest = (req, res, next) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const { lat, lon, name, custom_polygon, road_setback, building_setback, parcel_type } = JSON.parse(body);
            const scriptPath = path.resolve(__dirname, '../fetch_custom_site.py');
            const venvPython = path.resolve(__dirname, '../../.venv/bin/python');
            const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
            const safeName = name || 'Custom Location';
            const rSetback = road_setback !== undefined ? String(road_setback) : '2.0';
            const bSetback = building_setback !== undefined ? String(building_setback) : '3.0';
            const pType = parcel_type === 'voronoi' ? 'voronoi' : 'convex_hull';

            const args = [
              '-u',
              scriptPath,
              '--lat', String(lat),
              '--lon', String(lon),
              '--name', safeName,
              '--road-setback', rSetback,
              '--building-setback', bSetback,
              '--parcel-type', pType,
            ];

            if (Array.isArray(custom_polygon) && custom_polygon.length >= 3) {
              args.push('--polygon', JSON.stringify(custom_polygon));
            }

            const cleanEnv = { ...process.env };
            delete cleanEnv.http_proxy;
            delete cleanEnv.https_proxy;
            delete cleanEnv.HTTP_PROXY;
            delete cleanEnv.HTTPS_PROXY;
            delete cleanEnv.all_proxy;
            delete cleanEnv.ALL_PROXY;

            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });

            const pyProc = spawn(pythonCmd, args, { cwd: path.resolve(__dirname, '..'), env: cleanEnv });

            let stdoutBuf = '';
            let stderrBuf = '';
            let resultSent = false;

            pyProc.stdout.on('data', (chunk) => {
              stdoutBuf += chunk.toString();
              const lines = stdoutBuf.split('\n');
              stdoutBuf = lines.pop();

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('PROGRESS:')) {
                  try {
                    const progData = JSON.parse(trimmed.slice(9));
                    res.write(`data: ${JSON.stringify({ type: 'progress', ...progData })}\n\n`);
                  } catch (e) {}
                } else if (trimmed.startsWith('RESULT:')) {
                  try {
                    const resultData = JSON.parse(trimmed.slice(7));
                    res.write(`data: ${JSON.stringify({ type: 'complete', site: resultData })}\n\n`);
                    resultSent = true;
                  } catch (e) {}
                }
              }
            });

            pyProc.stderr.on('data', (chunk) => {
              stderrBuf += chunk.toString();
            });

            pyProc.on('close', (code, signal) => {
              if (code !== 0 && !resultSent) {
                const errMsg = stderrBuf.trim().split('\n').pop() || (signal ? `Process terminated with signal ${signal}` : `Process exited with code ${code}`);
                res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
              }
              res.end();
            });
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          }
        });
      } else {
        next();
      }
    };

    const handleDeleteRequest = (req, res, next) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const { site_id } = JSON.parse(body);
            if (!site_id) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing site_id' }));
              return;
            }

            const scriptPath = path.resolve(__dirname, '../delete_custom_site.py');
            const venvPython = path.resolve(__dirname, '../../.venv/bin/python');
            const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
            const cmd = `"${pythonCmd}" "${scriptPath}" --site_id "${site_id}"`;

            console.log(`[Vite Delete API] Executing: ${cmd}`);

            exec(cmd, { cwd: path.resolve(__dirname, '..') }, (error, stdout, stderr) => {
              if (error) {
                console.error('[Vite Delete API Error]:', stderr || error.message);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: stderr || error.message }));
                return;
              }
              try {
                const data = JSON.parse(stdout.trim());
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
              } catch (e) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, site_id }));
              }
            });
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          }
        });
      } else {
        next();
      }
    };

    server.middlewares.use('/api/fetch-custom-site', handleFetchRequest);
    server.middlewares.use('/api/harvest-custom-site', handleFetchRequest);
    server.middlewares.use('/api/delete-custom-site', handleDeleteRequest);
  },
});

export default defineConfig({
  plugins: [react(), fetchPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    cors: true,
    open: false,
    fs: {
      strict: false,
      allow: ['..'],
    },
  },
});
