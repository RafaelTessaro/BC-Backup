// Senha SMTP cifrada com safeStorage (DPAPI no Windows, Keychain no macOS, libsecret/kwallet no Linux).
// Formato guardado: "a1:<base64>" (API assíncrona, recomendada no Electron 44) ou "s1:<base64>" (síncrona).
// A senha nunca volta para o renderer — só `hasPassword`.

import { safeStorage } from 'electron'
import { log } from './logger'

export async function sealSecret(plain: string): Promise<string> {
  try {
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      return `a1:${(await safeStorage.encryptStringAsync(plain)).toString('base64')}`
    }
  } catch (e) {
    log.warn('safeStorage assíncrono indisponível', e)
  }
  if (safeStorage.isEncryptionAvailable()) return `s1:${safeStorage.encryptString(plain).toString('base64')}`
  throw new Error(
    'Não foi possível proteger a senha neste computador (o cofre de senhas do sistema não está disponível).'
  )
}

/** Decifra; `reseal` recebe o novo valor quando a chave do sistema foi trocada. */
export async function openSecret(stored: string, reseal?: (value: string) => void): Promise<string> {
  const [kind, b64] = stored.includes(':') ? [stored.slice(0, 2), stored.slice(3)] : ['a1', stored]
  const buf = Buffer.from(b64, 'base64')
  if (kind === 's1') return safeStorage.decryptString(buf)
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(buf)
  if (shouldReEncrypt && reseal) {
    sealSecret(result).then(reseal, () => {})
  }
  return result
}

/** No Linux sem chaveiro a "cifra" é só ofuscação — vale avisar no log. */
export function weakSecretStorage(): boolean {
  if (process.platform !== 'linux') return false
  try {
    return safeStorage.getSelectedStorageBackend() === 'basic_text'
  } catch {
    return false
  }
}
