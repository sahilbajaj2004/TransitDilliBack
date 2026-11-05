module.exports = {
  apps: [
    {
      name: 'transitdilli-backend',
      script: './dist/server.js',
      instances: 1, // Single instance to prevent redundant OTD Delhi 9s polling
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },
    },
  ],
};
