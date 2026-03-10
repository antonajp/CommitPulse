-- Rollback Migration 014: Knowledge Concentration analysis views
-- Ticket: IQS-903
--
-- Drops the vw_knowledge_concentration and vw_module_bus_factor views.
-- Safe to run multiple times.

-- Drop the module-level aggregation view first (depends on vw_knowledge_concentration)
DROP VIEW IF EXISTS vw_module_bus_factor;

-- Drop the main knowledge concentration view
DROP VIEW IF EXISTS vw_knowledge_concentration;

-- Note: Indexes created by this migration are generally useful and may be shared
-- with other queries. Only drop them if explicitly needed:
-- DROP INDEX IF EXISTS idx_commit_history_author;
-- DROP INDEX IF EXISTS idx_commit_files_filename;
