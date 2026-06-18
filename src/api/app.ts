import express from 'express';
import accountsRouter from './routes/accounts';
import transfersRouter from './routes/transfers';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(express.json()); // parse JSON request bodies

// mount routers
app.use('/accounts', accountsRouter);
app.use('/transfers', transfersRouter);

// error handler must be last
app.use(errorHandler);


export default app;