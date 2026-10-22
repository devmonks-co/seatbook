import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFound } from './lib/errors';
import authRoutes from './routes/auth';
import eventRoutes from './routes/events';
import bookingRoutes from './routes/bookings';
import holdRoutes from './routes/holds';

export function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '20kb' }));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/auth', authRoutes);
  app.use('/events', eventRoutes);
  app.use('/bookings', bookingRoutes);
  app.use('/holds', holdRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
