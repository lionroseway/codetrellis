/**
 * Runs in Electron (see run.ts). Starts the way src/electron/main.ts does —
 * dictionaries installed before ready, every session confined as it is
 * created — opens a window with something to check, and reports what the
 * spellchecker did. `CHECK_MODE=control` skips all of that, so run.ts can
 * show the check would see a download if one happened.
 */
import { app, BrowserWindow } from 'electron';
import { installDictionaries, confineSpellcheck } from '../../src/electron/spellcheck';

const userData = process.env.CHECK_USER_DATA!;
app.setPath('userData', userData);
app.on('window-all-closed', () => { /* the check decides when to exit */ });

const events: Array<{ event: string; language: string }> = [];
const confined = process.env.CHECK_MODE !== 'control';
const installed = confined ? installDictionaries(process.env.CHECK_BUNDLE!, userData) : [];

app.on('session-created', (ses) => {
  for (const event of [
    'spellcheck-dictionary-initialized',
    'spellcheck-dictionary-download-begin',
    'spellcheck-dictionary-download-success',
    'spellcheck-dictionary-download-failure',
  ] as const) {
    ses.on(event as 'spellcheck-dictionary-initialized', (_e, language: string) => events.push({ event, language }));
  }
  if (confined) confineSpellcheck(ses, installed, app.getPreferredSystemLanguages());
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<textarea autofocus>teh quikc brwon fox</textarea>');
  // Long enough for a download to be attempted and a dictionary to load.
  await new Promise((r) => setTimeout(r, 6000));
  process.stdout.write(`SPELLCHECK-RESULT ${JSON.stringify({
    installed,
    languages: win.webContents.session.getSpellCheckerLanguages(),
    events,
  })}\n`);
  app.exit(0);
});
