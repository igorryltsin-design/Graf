import { User } from '../lib/types';

const now = new Date();
const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

export const users: User[] = [
  {
    id: 'local-analyst_a',
    username: 'analyst_a',
    clearance_level: 'CONFIDENTIAL',
    attributes: {
      sector: 'A',
      sectors: ['A'],
      role: 'analyst'
    },
    query_budget: 8,
    budget_reset_at: oneHourLater
  },
  {
    id: 'local-commander',
    username: 'commander',
    clearance_level: 'SECRET',
    attributes: {
      sector: 'ALL',
      sectors: ['A', 'B', 'C'],
      role: 'commander'
    },
    query_budget: 20,
    budget_reset_at: oneHourLater
  }
];
