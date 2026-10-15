/**
 * PM2 Ecosystem Config — Falcon QR Printer, agente local
 *
 * La instalación y el arranque con Windows los hace scripts\install-windows.ps1
 * (registra una tarea programada que ejecuta `pm2 resurrect` al iniciar sesión).
 *
 * Uso manual:
 *   npm run pm2:start    ← inicia el agente
 *   npm run pm2:stop     ← detiene el agente
 *   npm run pm2:logs     ← ver logs en tiempo real
 *   pm2 status           ← ver estado
 *   pm2 save             ← guardar lista de procesos para el arranque automático
 */
module.exports = {
  apps: [
    {
      name: "print-agent",
      script: "./agent.js",

      // Solo 1 instancia: dos agentes imprimirían doble. El agente además se
      // niega a iniciar si su puerto local ya está en uso.
      instances: 1,
      exec_mode: "fork",

      // Reiniciar automáticamente si el agente se cae
      autorestart: true,
      restart_delay: 5000,      // Esperar 5 s antes de reiniciar tras un crash
      max_restarts: 50,
      min_uptime: "10s",        // Considerar estable si dura al menos 10 s
      exp_backoff_restart_delay: 2000,

      // Cierre ordenado: en Windows PM2 avisa con un mensaje en lugar de una señal
      shutdown_with_message: true,
      kill_timeout: 15000,

      // No vigilar cambios de archivos en producción
      watch: false,

      // Analizar PDF grandes requiere memoria; se reinicia solo si se desborda
      max_memory_restart: "800M",

      // Archivos de log de PM2 (el agente escribe además en C:\ElArrecife\Logs)
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
