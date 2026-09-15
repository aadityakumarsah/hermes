import type { TenantId, UserId } from './id.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export type JobType = 'tool_execution' | 'memory_consolidation' | 'notification' | 'workflow' | 'integration';

export interface JobPayload {
  [key: string]: unknown;
}

export interface Job {
  id: string;
  tenantId?: TenantId;
  userId?: UserId;
  type: JobType;
  status: JobStatus;
  payload: JobPayload;
  result?: unknown;
  error?: string;
  attempts: number;
  maxAttempts: number;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface JobScheduler {
  enqueue(job: Omit<Job, 'id' | 'status' | 'attempts' | 'createdAt'>): Promise<Job>;
  schedule(job: Omit<Job, 'id' | 'status' | 'attempts' | 'createdAt'>, at: Date): Promise<Job>;
  cancel(jobId: string): Promise<boolean>;
  get(jobId: string): Promise<Job | undefined>;
}