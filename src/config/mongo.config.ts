import { registerAs } from '@nestjs/config';

export default registerAs('mongo', () => ({
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/datarefinery',
}));
