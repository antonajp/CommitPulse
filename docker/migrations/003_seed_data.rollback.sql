-- Rollback for Migration 003: Remove seed data
-- Ticket: IQS-850

DELETE FROM gitr_pipeline_run
WHERE class_name = 'PostgresDB'
  AND context = 'Db internal logging function';
