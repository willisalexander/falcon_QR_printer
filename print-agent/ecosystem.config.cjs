/**
 * PM2 Ecosystem Config — Print QR System Agent
 *
 * Instalación de PM2 (una sola vez):
 *   npm install -g pm2
 *   pm2 install pm2-windows-startup   ← para arranque automático en Windows
 *   pm2-startup install
 *
 * Uso:
 *   npm run pm2:start    ← inicia el agente
 *   npm run pm2:stop     ← detiene el agente
 *   npm run pm2:logs     ← ver logs en tiempo real
 *   pm2 status           ← ver estado
 *   pm2 save             ← guardar lista de procesos para arranque automático
 */
module.exports = {
  apps: [
    {
      name: "print-agent",
      script: "./agent.js",

      // Solo 1 instancia — más de una causaría conflictos en la impresora
      instances: 1,
      exec_mode: "fork",

      // Reiniciar automáticamente si el agente se cae
      autorestart: true,
      restart_delay: 5000,      // Esperar 5 s antes de reiniciar tras un crash
      max_restarts: 10,         // Máximo 10 reinicios antes de marcar como errored
      min_uptime: "10s",        // Considerar estable si dura al menos 10 s

      // No vigilar cambios de archivos en producción
      watch: false,

      // Límite de memoria
      max_memory_restart: "200M",

      // Archivos de log (además del logging interno del agente)
      error_file: "./logs/pm2-error.log",
      out_file:   "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Variables de entorno (alternativa al archivo .env)
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
