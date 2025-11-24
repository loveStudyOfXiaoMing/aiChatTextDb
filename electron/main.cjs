const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const db = require('./db.cjs');

const isDev = !!process.env.ELECTRON_START_URL || !app.isPackaged;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  db.closeAll();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('db:connect', async (_event, config) => db.connect(config));
ipcMain.handle('db:listSchema', async (_event, payload) => db.listSchema(payload.connId, payload.database));
ipcMain.handle('db:runQuery', async (_event, payload) => db.runQuery(payload.connId, payload.sql, payload.database));
ipcMain.handle('db:close', async (_event, payload) => db.close(payload.connId));
