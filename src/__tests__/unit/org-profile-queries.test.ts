import { describe, it, expect } from 'vitest';
import {
  QUERY_ALL_ORGANIZATIONS,
  QUERY_ORG_SUMMARY_STATS,
  QUERY_ORG_LOC_PER_WEEK,
  QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM,
  QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM,
  QUERY_ORG_TECH_STACK,
  QUERY_ORG_COMMENTS_PER_WEEK,
  QUERY_ORG_TESTS_PER_WEEK,
  QUERY_ORG_HYGIENE_SCORE,
  QUERY_ORG_VELOCITY_VS_LOC,
  QUERY_ORG_HOT_SPOTS,
  QUERY_ORG_KNOWLEDGE_CONCENTRATION,
  QUERY_ORG_TABLE_EXISTS,
  QUERY_TEAMS_ORG_FK_EXISTS,
  ORG_PROFILE_MAX_ROWS,
} from '../../database/queries/org-profile-queries.js';

/**
 * Unit tests for Organization Profile SQL Queries.
 * Validates that queries:
 *   1. Use parameterized placeholders ($1, $2, etc.) - no SQL injection
 *   2. JOIN through normalized tables (organizations -> teams -> commit_contributors)
 *   3. Use correct Jira join pattern: COALESCE(jira_name, full_name)
 *
 * Ticket: GITX-203
 */
describe('Organization Profile Queries (GITX-203)', () => {
  describe('Query Constants', () => {
    it('should have ORG_PROFILE_MAX_ROWS defined', () => {
      expect(ORG_PROFILE_MAX_ROWS).toBe(500);
    });
  });

  describe('QUERY_ALL_ORGANIZATIONS', () => {
    it('should be a non-empty string', () => {
      expect(QUERY_ALL_ORGANIZATIONS).toBeDefined();
      expect(typeof QUERY_ALL_ORGANIZATIONS).toBe('string');
      expect(QUERY_ALL_ORGANIZATIONS.length).toBeGreaterThan(0);
    });

    it('should select from organizations table', () => {
      expect(QUERY_ALL_ORGANIZATIONS).toContain('FROM organizations');
    });

    it('should join with teams table', () => {
      expect(QUERY_ALL_ORGANIZATIONS).toContain('JOIN teams');
    });

    it('should count teams per organization', () => {
      expect(QUERY_ALL_ORGANIZATIONS).toContain('COUNT(DISTINCT t.id)');
      expect(QUERY_ALL_ORGANIZATIONS).toContain('team_count');
    });

    it('should have LIMIT clause for safety', () => {
      expect(QUERY_ALL_ORGANIZATIONS).toContain('LIMIT');
    });

    it('should NOT contain string interpolation patterns', () => {
      // Check for dangerous patterns like ${} or string concatenation
      expect(QUERY_ALL_ORGANIZATIONS).not.toMatch(/\$\{[^}]+\}/);
    });
  });

  describe('QUERY_ORG_SUMMARY_STATS', () => {
    it('should be a non-empty string', () => {
      expect(QUERY_ORG_SUMMARY_STATS).toBeDefined();
      expect(typeof QUERY_ORG_SUMMARY_STATS).toBe('string');
    });

    it('should use parameterized placeholder $1 for organization_id', () => {
      expect(QUERY_ORG_SUMMARY_STATS).toContain('$1');
    });

    it('should have org_teams CTE with organization_id filter', () => {
      expect(QUERY_ORG_SUMMARY_STATS).toContain('WITH org_teams AS');
      expect(QUERY_ORG_SUMMARY_STATS).toContain('organization_id = $1');
    });

    it('should have team_members CTE joining through team_id', () => {
      expect(QUERY_ORG_SUMMARY_STATS).toContain('team_members AS');
      expect(QUERY_ORG_SUMMARY_STATS).toContain('cc.team_id = t.team_id');
    });

    it('should return team_count, contributor_count, total_loc, total_commits', () => {
      expect(QUERY_ORG_SUMMARY_STATS).toContain('team_count');
      expect(QUERY_ORG_SUMMARY_STATS).toContain('contributor_count');
      expect(QUERY_ORG_SUMMARY_STATS).toContain('total_loc');
      expect(QUERY_ORG_SUMMARY_STATS).toContain('total_commits');
    });
  });

  describe('QUERY_ORG_LOC_PER_WEEK', () => {
    it('should use parameterized placeholders $1, $2, $3', () => {
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('$1');
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('$2');
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('$3');
    });

    it('should use DATE_TRUNC with $3 for aggregation period', () => {
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('DATE_TRUNC($3');
    });

    it('should filter by commit_date >= $2', () => {
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('commit_date >= $2');
    });

    it('should exclude merge commits', () => {
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('is_merge = FALSE');
    });

    it('should return lines_added, lines_deleted, net_lines, commit_count', () => {
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('lines_added');
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('lines_deleted');
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('net_lines');
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('commit_count');
    });

    it('should JOIN through org_teams -> team_members pattern', () => {
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('WITH org_teams AS');
      expect(QUERY_ORG_LOC_PER_WEEK).toContain('team_members AS');
    });
  });

  describe('QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM', () => {
    it('should use parameterized placeholder $1 for organization_id', () => {
      expect(QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM).toContain('$1');
    });

    it('should limit to 15 files', () => {
      expect(QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM).toContain('LIMIT 15');
    });

    it('should order by complexity descending', () => {
      expect(QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM).toContain('ORDER BY complexity DESC');
    });

    it('should return team_name for breakdown', () => {
      expect(QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM).toContain('team_name');
    });

    it('should calculate percentage per team', () => {
      expect(QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM).toContain('percentage');
    });

    it('should use COALESCE for complexity fallback', () => {
      expect(QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM).toContain('COALESCE(cf.complexity');
    });
  });

  describe('QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM', () => {
    it('should use parameterized placeholder $1 for organization_id', () => {
      expect(QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM).toContain('$1');
    });

    it('should limit to 20 files', () => {
      expect(QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM).toContain('LIMIT 20');
    });

    it('should order by total_churn descending', () => {
      expect(QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM).toContain('ORDER BY total_churn DESC');
    });

    it('should exclude node_modules and vendor directories', () => {
      expect(QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM).toContain("NOT LIKE 'node_modules/%'");
      expect(QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM).toContain("NOT LIKE 'vendor/%'");
    });

    it('should return team_name for breakdown', () => {
      expect(QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM).toContain('team_name');
    });
  });

  describe('QUERY_ORG_TECH_STACK', () => {
    it('should use parameterized placeholders $1 for organization_id and $2 for start_date', () => {
      expect(QUERY_ORG_TECH_STACK).toContain('$1');
      expect(QUERY_ORG_TECH_STACK).toContain('$2');
    });

    it('should join with vw_technology_stack_category for category mapping', () => {
      expect(QUERY_ORG_TECH_STACK).toContain('vw_technology_stack_category');
    });

    it('should calculate percentage of total LOC', () => {
      expect(QUERY_ORG_TECH_STACK).toContain('percentage');
    });

    it('should limit to 20 categories', () => {
      expect(QUERY_ORG_TECH_STACK).toContain('LIMIT 20');
    });

    it('should select category from the view', () => {
      expect(QUERY_ORG_TECH_STACK).toContain('vtsc.category');
    });
  });

  describe('QUERY_ORG_COMMENTS_PER_WEEK', () => {
    it('should use parameterized placeholders $1, $2, $3', () => {
      expect(QUERY_ORG_COMMENTS_PER_WEEK).toContain('$1');
      expect(QUERY_ORG_COMMENTS_PER_WEEK).toContain('$2');
      expect(QUERY_ORG_COMMENTS_PER_WEEK).toContain('$3');
    });

    it('should use dynamic aggregation period via $3 parameter', () => {
      expect(QUERY_ORG_COMMENTS_PER_WEEK).toContain('DATE_TRUNC($3');
    });

    it('should sum total_comment_lines', () => {
      expect(QUERY_ORG_COMMENTS_PER_WEEK).toContain('total_comment_lines');
    });

    it('should filter by commit_date >= $2', () => {
      expect(QUERY_ORG_COMMENTS_PER_WEEK).toContain('commit_date >= $2');
    });
  });

  describe('QUERY_ORG_TESTS_PER_WEEK', () => {
    it('should use parameterized placeholders $1, $2', () => {
      expect(QUERY_ORG_TESTS_PER_WEEK).toContain('$1');
      expect(QUERY_ORG_TESTS_PER_WEEK).toContain('$2');
    });

    it('should filter for test files using LIKE patterns', () => {
      expect(QUERY_ORG_TESTS_PER_WEEK).toContain("LIKE '%test%'");
      expect(QUERY_ORG_TESTS_PER_WEEK).toContain("LIKE '%spec%'");
      expect(QUERY_ORG_TESTS_PER_WEEK).toContain("LIKE '%__tests__%'");
    });

    it('should return test_files_modified count', () => {
      expect(QUERY_ORG_TESTS_PER_WEEK).toContain('test_files_modified');
    });

    it('should return test_lines_added', () => {
      expect(QUERY_ORG_TESTS_PER_WEEK).toContain('test_lines_added');
    });
  });

  describe('QUERY_ORG_HYGIENE_SCORE', () => {
    it('should use parameterized placeholder $1 for organization_id', () => {
      expect(QUERY_ORG_HYGIENE_SCORE).toContain('$1');
    });

    it('should calculate average hygiene_score', () => {
      expect(QUERY_ORG_HYGIENE_SCORE).toContain('AVG(vh.hygiene_score)');
    });

    it('should count conventional_commits', () => {
      expect(QUERY_ORG_HYGIENE_SCORE).toContain('conventional_commits');
    });

    it('should calculate conventional_pct', () => {
      expect(QUERY_ORG_HYGIENE_SCORE).toContain('conventional_pct');
    });

    it('should join with vw_commit_hygiene view', () => {
      expect(QUERY_ORG_HYGIENE_SCORE).toContain('vw_commit_hygiene');
    });
  });

  describe('QUERY_ORG_VELOCITY_VS_LOC', () => {
    it('should use parameterized placeholders $1, $2, $3', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('$1');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('$2');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('$3');
    });

    it('should use org_teams CTE with organization_id = $1', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('WITH org_teams AS');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('organization_id = $1');
    });

    it('should use team_members CTE with team_id FK join', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('team_members AS');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('cc.team_id = t.team_id');
    });

    it('should include jira_name in team_members CTE', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('cc.jira_name');
    });

    it('should use CRITICAL Jira join pattern: COALESCE(jira_name, full_name)', () => {
      // The critical fix from ticket: Join on COALESCE(tm.jira_name, tm.full_name)
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('COALESCE(tm.jira_name, tm.full_name)');
    });

    it('should NOT use incorrect login/email pattern for Jira join', () => {
      // The ticket explicitly says NOT to use: ld.assignee = tm.email OR ld.assignee = tm.login
      // Check that we don't have the wrong pattern in the Jira CTE
      const jiraCteMatch = QUERY_ORG_VELOCITY_VS_LOC.match(/team_jira_points[\s\S]*?GROUP BY/);
      if (jiraCteMatch) {
        const jiraCte = jiraCteMatch[0];
        // Should NOT contain email or login in the Jira assignee join
        expect(jiraCte).not.toContain('= tm.email');
        expect(jiraCte).not.toContain('= tm.login');
      }
    });

    it('should combine Linear and Jira points in combined_points CTE', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('combined_points AS');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('team_linear_points');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('team_jira_points');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('UNION ALL');
    });

    it('should use FULL OUTER JOIN for commits and points', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('FULL OUTER JOIN');
    });

    it('should filter for completed Linear issues', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain("state IN ('Done', 'Completed')");
    });

    it('should filter for done Jira issues', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain("to_value IN ('Done', 'Closed', 'Resolved')");
    });

    it('should return story_points, lines_of_code, issue_count, commit_count', () => {
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('story_points');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('lines_of_code');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('issue_count');
      expect(QUERY_ORG_VELOCITY_VS_LOC).toContain('commit_count');
    });
  });

  describe('QUERY_ORG_HOT_SPOTS', () => {
    it('should use parameterized placeholder $1 for organization_id', () => {
      expect(QUERY_ORG_HOT_SPOTS).toContain('$1');
    });

    it('should join with vw_hot_spots view', () => {
      expect(QUERY_ORG_HOT_SPOTS).toContain('vw_hot_spots');
    });

    it('should limit to 10 hot spots', () => {
      expect(QUERY_ORG_HOT_SPOTS).toContain('LIMIT 10');
    });

    it('should order by risk_score descending', () => {
      expect(QUERY_ORG_HOT_SPOTS).toContain('ORDER BY hs.risk_score DESC');
    });

    it('should return team_name with each hot spot', () => {
      expect(QUERY_ORG_HOT_SPOTS).toContain('team_name');
    });

    it('should return risk_score and risk_tier', () => {
      expect(QUERY_ORG_HOT_SPOTS).toContain('risk_score');
      expect(QUERY_ORG_HOT_SPOTS).toContain('risk_tier');
    });
  });

  describe('QUERY_ORG_KNOWLEDGE_CONCENTRATION', () => {
    it('should use parameterized placeholder $1 for organization_id', () => {
      expect(QUERY_ORG_KNOWLEDGE_CONCENTRATION).toContain('$1');
    });

    it('should join with vw_knowledge_concentration view', () => {
      expect(QUERY_ORG_KNOWLEDGE_CONCENTRATION).toContain('vw_knowledge_concentration');
    });

    it('should limit to 30 files', () => {
      expect(QUERY_ORG_KNOWLEDGE_CONCENTRATION).toContain('LIMIT 30');
    });

    it('should order by top_contributor_pct descending', () => {
      expect(QUERY_ORG_KNOWLEDGE_CONCENTRATION).toContain('ORDER BY kc.top_contributor_pct DESC');
    });

    it('should return team_name with each file', () => {
      expect(QUERY_ORG_KNOWLEDGE_CONCENTRATION).toContain('team_name');
    });

    it('should return concentration_risk', () => {
      expect(QUERY_ORG_KNOWLEDGE_CONCENTRATION).toContain('concentration_risk');
    });
  });

  describe('View/Table Existence Queries', () => {
    describe('QUERY_ORG_TABLE_EXISTS', () => {
      it('should check information_schema.tables for organizations', () => {
        expect(QUERY_ORG_TABLE_EXISTS).toContain('information_schema.tables');
        expect(QUERY_ORG_TABLE_EXISTS).toContain("table_name = 'organizations'");
      });

      it('should return table_exists boolean', () => {
        expect(QUERY_ORG_TABLE_EXISTS).toContain('table_exists');
      });
    });

    describe('QUERY_TEAMS_ORG_FK_EXISTS', () => {
      it('should check information_schema.columns for organization_id', () => {
        expect(QUERY_TEAMS_ORG_FK_EXISTS).toContain('information_schema.columns');
        expect(QUERY_TEAMS_ORG_FK_EXISTS).toContain("table_name = 'teams'");
        expect(QUERY_TEAMS_ORG_FK_EXISTS).toContain("column_name = 'organization_id'");
      });

      it('should return column_exists boolean', () => {
        expect(QUERY_TEAMS_ORG_FK_EXISTS).toContain('column_exists');
      });
    });
  });

  describe('SQL Injection Prevention', () => {
    const allQueries = [
      { name: 'QUERY_ALL_ORGANIZATIONS', query: QUERY_ALL_ORGANIZATIONS },
      { name: 'QUERY_ORG_SUMMARY_STATS', query: QUERY_ORG_SUMMARY_STATS },
      { name: 'QUERY_ORG_LOC_PER_WEEK', query: QUERY_ORG_LOC_PER_WEEK },
      { name: 'QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM', query: QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM },
      { name: 'QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM', query: QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM },
      { name: 'QUERY_ORG_TECH_STACK', query: QUERY_ORG_TECH_STACK },
      { name: 'QUERY_ORG_COMMENTS_PER_WEEK', query: QUERY_ORG_COMMENTS_PER_WEEK },
      { name: 'QUERY_ORG_TESTS_PER_WEEK', query: QUERY_ORG_TESTS_PER_WEEK },
      { name: 'QUERY_ORG_HYGIENE_SCORE', query: QUERY_ORG_HYGIENE_SCORE },
      { name: 'QUERY_ORG_VELOCITY_VS_LOC', query: QUERY_ORG_VELOCITY_VS_LOC },
      { name: 'QUERY_ORG_HOT_SPOTS', query: QUERY_ORG_HOT_SPOTS },
      { name: 'QUERY_ORG_KNOWLEDGE_CONCENTRATION', query: QUERY_ORG_KNOWLEDGE_CONCENTRATION },
      { name: 'QUERY_ORG_TABLE_EXISTS', query: QUERY_ORG_TABLE_EXISTS },
      { name: 'QUERY_TEAMS_ORG_FK_EXISTS', query: QUERY_TEAMS_ORG_FK_EXISTS },
    ];

    it.each(allQueries)(
      '$name should NOT contain dangerous string interpolation patterns',
      ({ query }) => {
        // Template literal interpolation ${...} should only be ORG_PROFILE_MAX_ROWS
        const interpolations = query.match(/\$\{[^}]+\}/g) || [];
        for (const interp of interpolations) {
          expect(interp).toBe('${ORG_PROFILE_MAX_ROWS}');
        }
      }
    );

    it.each(allQueries)(
      '$name should NOT contain EXECUTE or PREPARE statements (dynamic SQL)',
      ({ query }) => {
        expect(query.toUpperCase()).not.toContain('EXECUTE');
        expect(query.toUpperCase()).not.toContain('PREPARE');
      }
    );
  });

  describe('Normalized Table Join Pattern', () => {
    const queriesWithOrgFilter = [
      { name: 'QUERY_ORG_SUMMARY_STATS', query: QUERY_ORG_SUMMARY_STATS },
      { name: 'QUERY_ORG_LOC_PER_WEEK', query: QUERY_ORG_LOC_PER_WEEK },
      { name: 'QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM', query: QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM },
      { name: 'QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM', query: QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM },
      { name: 'QUERY_ORG_TECH_STACK', query: QUERY_ORG_TECH_STACK },
      { name: 'QUERY_ORG_COMMENTS_PER_WEEK', query: QUERY_ORG_COMMENTS_PER_WEEK },
      { name: 'QUERY_ORG_TESTS_PER_WEEK', query: QUERY_ORG_TESTS_PER_WEEK },
      { name: 'QUERY_ORG_HYGIENE_SCORE', query: QUERY_ORG_HYGIENE_SCORE },
      { name: 'QUERY_ORG_VELOCITY_VS_LOC', query: QUERY_ORG_VELOCITY_VS_LOC },
      { name: 'QUERY_ORG_HOT_SPOTS', query: QUERY_ORG_HOT_SPOTS },
      { name: 'QUERY_ORG_KNOWLEDGE_CONCENTRATION', query: QUERY_ORG_KNOWLEDGE_CONCENTRATION },
    ];

    it.each(queriesWithOrgFilter)(
      '$name should use org_teams CTE with organization_id = $1',
      ({ query }) => {
        expect(query).toContain('WITH org_teams AS');
        expect(query).toContain('organization_id = $1');
      }
    );

    it.each(queriesWithOrgFilter)(
      '$name should use team_members CTE joining through team_id',
      ({ query }) => {
        expect(query).toContain('team_members AS');
        // The join should be on team_id (normalized FK)
        expect(query).toContain('team_id');
      }
    );
  });
});
