import {createControlPlaneApp} from './app.js';

const port = Number.parseInt(process.env.AGENTS_KIT_GUI_PORT || '3710', 10);
const {app} = createControlPlaneApp();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`[agents-kit GUI Server] Running on http://localhost:${port}`);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.warn(`Port ${port} is already in use by another GUI server instance.`);
    process.exit(0);
  }
  throw error;
});
