import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsFilePath = path.join(__dirname, 'userSettings.json');

// Carrega as configurações do arquivo JSON local
function loadSettings() {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const data = fs.readFileSync(settingsFilePath, 'utf-8');
      return JSON.parse(data || '{}');
    }
  } catch (err) {
    console.error('⚠️ [SETTINGS] Erro ao ler userSettings.json:', err.message);
  }
  return {};
}

// Grava as configurações no arquivo JSON local
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('⚠️ [SETTINGS] Erro ao salvar userSettings.json:', err.message);
  }
}

/**
 * Retorna se o usuário deseja exibir os EMOJIS de conquista no apelido
 * (o sufixo [+x] com o total de conquistas aparece sempre, independente
 * disso). Retorna false por padrão (opt-in) — o padrão do servidor é só
 * o [+x], sem os emojis.
 * @param {string} userId - ID do usuário Discord
 * @returns {boolean}
 */
export function getShowBadgesSetting(userId) {
  const settings = loadSettings();
  return settings[userId] === true;
}

/**
 * Define se o usuário deseja exibir as tags de conquistas no apelido.
 * @param {string} userId - ID do usuário Discord
 * @param {boolean} show - Se deve exibir as tags
 */
export function setShowBadgesSetting(userId, show) {
  const settings = loadSettings();
  settings[userId] = show;
  saveSettings(settings);
}

/**
 * Retorna a lista de nomes de conquistas selecionadas pelo usuário para exibir no apelido.
 * @param {string} userId - ID do usuário Discord
 * @returns {Array<string>|null}
 */
export function getUserSelectedBadges(userId) {
  const settings = loadSettings();
  return settings[`${userId}:selected`] || null;
}

/**
 * Define a lista de conquistas que o usuário deseja exibir no apelido.
 * @param {string} userId - ID do usuário Discord
 * @param {Array<string>} badges - Lista de nomes de conquistas
 */
export function setUserSelectedBadges(userId, badges) {
  const settings = loadSettings();
  settings[`${userId}:selected`] = badges;
  saveSettings(settings);
}
