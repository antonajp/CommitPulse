-- Migration 002: Create all views for gitrx schema
-- Ported from legacy/sql/createCommitHistory.sql
-- Ticket: IQS-850
--
-- All views use CREATE OR REPLACE for idempotency.
-- View definitions preserved exactly from legacy schema.

-- ============================================================================
-- Team contributor views
-- ============================================================================

CREATE OR REPLACE VIEW max_num_count_per_login AS
WITH ranked AS (
    SELECT login,
           full_name,
           team,
           num_count,
           ROW_NUMBER() OVER (PARTITION BY login ORDER BY num_count DESC) AS rn
    FROM gitja_team_contributor
)
SELECT login, full_name, team, num_count
FROM ranked
WHERE rn = 1;

CREATE OR REPLACE VIEW num_count_per_full_name AS
WITH full_name_grouped_teams AS (
    SELECT full_name,
           team,
           SUM(num_count) AS num_count
    FROM gitja_team_contributor
    GROUP BY full_name, team
)
SELECT full_name, team, num_count
FROM full_name_grouped_teams;

CREATE OR REPLACE VIEW max_num_count_per_full_name AS
WITH ranked AS (
    SELECT full_name,
           team,
           num_count,
           ROW_NUMBER() OVER (PARTITION BY full_name ORDER BY num_count DESC) AS rn
    FROM num_count_per_full_name
)
SELECT full_name, team, num_count
FROM ranked
WHERE rn = 1;

-- ============================================================================
-- Jira issue views
-- ============================================================================

CREATE OR REPLACE VIEW vw_unfinished_jira_issues AS
SELECT jd.jira_key,
       jd.status,
       ij.to_value,
       ij.change_date
FROM jira_detail jd
    JOIN (
        SELECT jh.jira_key,
               jh.to_value,
               jh.change_date
        FROM jira_history jh
            JOIN (
                SELECT jira_history.jira_key,
                       MAX(jira_history.change_date) AS max_change_date
                FROM jira_history
                WHERE jira_history.field = 'status'::TEXT
                GROUP BY jira_history.jira_key
            ) subq ON jh.jira_key = subq.jira_key
                   AND jh.change_date = subq.max_change_date
                   AND jh.field = 'status'::TEXT
    ) ij ON jd.jira_key = ij.jira_key
WHERE jd.status <> ij.to_value;

-- ============================================================================
-- Technology stack views
-- ============================================================================

CREATE OR REPLACE VIEW vw_technology_stack_category AS
SELECT file_extension,
    CASE
        WHEN file_extension = '.aac' THEN 'Audio'
        WHEN file_extension = '.ac3' THEN 'Audio'
        WHEN file_extension = '.aiff' THEN 'Audio'
        WHEN file_extension = '.amr' THEN 'Audio'
        WHEN file_extension = '.au' THEN 'Audio'
        WHEN file_extension = '.flac' THEN 'Audio'
        WHEN file_extension = '.m4a' THEN 'Audio'
        WHEN file_extension = '.midi' THEN 'Audio'
        WHEN file_extension = '.mka' THEN 'Audio'
        WHEN file_extension = '.mp3' THEN 'Audio'
        WHEN file_extension = '.ogg' THEN 'Audio'
        WHEN file_extension = '.ra' THEN 'Audio'
        WHEN file_extension = '.voc' THEN 'Audio'
        WHEN file_extension = '.wav' THEN 'Audio'
        WHEN file_extension = '.wma' THEN 'Audio'
        WHEN file_extension = '.abnf' THEN 'Backend'
        WHEN file_extension = '.am' THEN 'Backend'
        WHEN file_extension = '.bnf' THEN 'Backend'
        WHEN file_extension = '.c' THEN 'Backend'
        WHEN file_extension = '.cc' THEN 'Backend'
        WHEN file_extension = '.cls' THEN 'Backend'
        WHEN file_extension = '.cpp' THEN 'Backend'
        WHEN file_extension = '.cs' THEN 'Backend'
        WHEN file_extension = '.env' THEN 'Backend'
        WHEN file_extension = '.exe' THEN 'Backend'
        WHEN file_extension = '.go' THEN 'Backend'
        WHEN file_extension = '.gyp' THEN 'Backend'
        WHEN file_extension = '.gypi' THEN 'Backend'
        WHEN file_extension = '.h' THEN 'Backend'
        WHEN file_extension = '.hbs' THEN 'Backend'
        WHEN file_extension = '.hex' THEN 'Backend'
        WHEN file_extension = '.abhppnf' THEN 'Backend'
        WHEN file_extension = '.iml' THEN 'Backend'
        WHEN file_extension = '.in' THEN 'Backend'
        WHEN file_extension = '.info' THEN 'Backend'
        WHEN file_extension = '.install' THEN 'Backend'
        WHEN file_extension = '.install~' THEN 'Backend'
        WHEN file_extension = '.java' THEN 'Backend'
        WHEN file_extension = '.jmx' THEN 'Backend'
        WHEN file_extension = '.jsdoc' THEN 'Document'
        WHEN file_extension = '.jsm' THEN 'Backend'
        WHEN file_extension = '.json5' THEN 'Backend'
        WHEN file_extension = '.jst' THEN 'Backend'
        WHEN file_extension = '.jsx' THEN 'Backend'
        WHEN file_extension = '.messageChannel' THEN 'Backend'
        WHEN file_extension = '.neon' THEN 'Backend'
        WHEN file_extension = '.node' THEN 'Backend'
        WHEN file_extension = '.php' THEN 'Backend'
        WHEN file_extension = '.php~' THEN 'Backend'
        WHEN file_extension = '.phpt' THEN 'Backend'
        WHEN file_extension = '.pl' THEN 'Backend'
        WHEN file_extension = '.pug' THEN 'Backend'
        WHEN file_extension = '.py' THEN 'Backend'
        WHEN file_extension = '.trigger' THEN 'Backend'
        WHEN file_extension = '.y' THEN 'Backend'
        WHEN file_extension = '.authprovider' THEN 'Configuration'
        WHEN file_extension = '.Automate_stage_for_Japan' THEN 'Configuration'
        WHEN file_extension = '.cachePartition' THEN 'Configuration'
        WHEN file_extension = '.connectedApp' THEN 'Configuration'
        WHEN file_extension = '.customerPermission' THEN 'Configuration'
        WHEN file_extension = '.dat' THEN 'Configuration'
        WHEN file_extension = '.data' THEN 'Configuration'
        WHEN file_extension = '.datacategorygroup' THEN 'Configuration'
        WHEN file_extension = '.doxy' THEN 'Configuration'
        WHEN file_extension = '.duplicateRule' THEN 'Configuration'
        WHEN file_extension = '.filters' THEN 'Configuration'
        WHEN file_extension = '.globalValueSet' THEN 'Configuration'
        WHEN file_extension = '.group' THEN 'Configuration'
        WHEN file_extension = '.LeadConvertString' THEN 'Configuration'
        WHEN file_extension = '.matchingRule' THEN 'Configuration'
        WHEN file_extension = '.md' THEN 'Configuration'
        WHEN file_extension = '.namedCredential' THEN 'Configuration'
        WHEN file_extension = '.network' THEN 'Configuration'
        WHEN file_extension = '.notiftype' THEN 'Configuration'
        WHEN file_extension = '.object' THEN 'Configuration'
        WHEN file_extension = '.objectTranslation' THEN 'Configuration'
        WHEN file_extension = '.permissionset' THEN 'Configuration'
        WHEN file_extension = '.profile' THEN 'Configuration'
        WHEN file_extension = '.remoteSite' THEN 'Configuration'
        WHEN file_extension = '.role' THEN 'Configuration'
        WHEN file_extension = '.sharingRules' THEN 'Configuration'
        WHEN file_extension = '.site' THEN 'Configuration'
        WHEN file_extension = '.standardValueSet' THEN 'Configuration'
        WHEN file_extension = '.Trailer_Parking_Spaces_per_1000md' THEN 'Configuration'
        WHEN file_extension = '.translation' THEN 'Configuration'
        WHEN file_extension = '.yaml' THEN 'Configuration'
        WHEN file_extension = '.index' THEN 'Database'
        WHEN file_extension = '.sql' THEN 'Database'
        WHEN file_extension = '.sqlite' THEN 'Database'
        WHEN file_extension = '.tf' THEN 'Database'
        WHEN file_extension = '' THEN 'Dev Ops'
        WHEN file_extension = '.ac' THEN 'Dev Ops'
        WHEN file_extension = '.acquia' THEN 'Dev Ops'
        WHEN file_extension = '.xbashxx' THEN 'Dev Ops'
        WHEN file_extension = '.bashrc' THEN 'Dev Ops'
        WHEN file_extension = '.bat' THEN 'Dev Ops'
        WHEN file_extension = '.bazel' THEN 'Dev Ops'
        WHEN file_extension = '.bin' THEN 'Dev Ops'
        WHEN file_extension = '.BSD' THEN 'Dev Ops'
        WHEN file_extension = '.co' THEN 'Dev Ops'
        WHEN file_extension = '.code-snippets' THEN 'Dev Ops'
        WHEN file_extension = '.conf' THEN 'Dev Ops'
        WHEN file_extension = '.config' THEN 'Dev Ops'
        WHEN file_extension = '.crt' THEN 'Dev Ops'
        WHEN file_extension = '.csr' THEN 'Dev Ops'
        WHEN file_extension = '.d8' THEN 'Dev Ops'
        WHEN file_extension = '.def' THEN 'Dev Ops'
        WHEN file_extension = '.diff' THEN 'Dev Ops'
        WHEN file_extension = '.disabled' THEN 'Dev Ops'
        WHEN file_extension = '.dist' THEN 'Dev Ops'
        WHEN file_extension = '.DotSettings' THEN 'Dev Ops'
        WHEN file_extension = '.ejs' THEN 'Dev Ops'
        WHEN file_extension = '.el' THEN 'Dev Ops'
        WHEN file_extension = '.engine' THEN 'Dev Ops'
        WHEN file_extension = '.ewkt' THEN 'Dev Ops'
        WHEN file_extension = '.example' THEN 'Dev Ops'
        WHEN file_extension = '.fontified' THEN 'Dev Ops'
        WHEN file_extension = '.git-id' THEN 'Dev Ops'
        WHEN file_extension = '.gitignore' THEN 'Dev Ops'
        WHEN file_extension = '.ini' THEN 'Dev Ops'
        WHEN file_extension = '.json' THEN 'Dev Ops'
        WHEN file_extension = '.xjsonIdxx' THEN 'Dev Ops'
        WHEN file_extension = '.key' THEN 'Dev Ops'
        WHEN file_extension = '.less' THEN 'Dev Ops'
        WHEN file_extension = '.lock' THEN 'Dev Ops'
        WHEN file_extension = '.log' THEN 'Dev Ops'
        WHEN file_extension = '.ls' THEN 'Dev Ops'
        WHEN file_extension = '.m4' THEN 'Dev Ops'
        WHEN file_extension = '.make' THEN 'Dev Ops'
        WHEN file_extension = '.mjs' THEN 'Dev Ops'
        WHEN file_extension = '.njs' THEN 'Dev Ops'
        WHEN file_extension = '.opts' THEN 'Dev Ops'
        WHEN file_extension = '.orig' THEN 'Dev Ops'
        WHEN file_extension = '.out' THEN 'Dev Ops'
        WHEN file_extension = '.output' THEN 'Dev Ops'
        WHEN file_extension = '.patch' THEN 'Dev Ops'
        WHEN file_extension = '.pbfilespec' THEN 'Dev Ops'
        WHEN file_extension = '.pem' THEN 'Dev Ops'
        WHEN file_extension = '.pfx' THEN 'Dev Ops'
        WHEN file_extension = '.phar' THEN 'Dev Ops'
        WHEN file_extension = '.priv' THEN 'Dev Ops'
        WHEN file_extension = '.properties' THEN 'Dev Ops'
        WHEN file_extension = '.pub' THEN 'Dev Ops'
        WHEN file_extension = '.pubkey' THEN 'Dev Ops'
        WHEN file_extension = '.rb' THEN 'Dev Ops'
        WHEN file_extension = '.rc' THEN 'Dev Ops'
        WHEN file_extension = '.resource' THEN 'Dev Ops'
        WHEN file_extension = '.settings' THEN 'Dev Ops'
        WHEN file_extension = '.sh' THEN 'Dev Ops'
        WHEN file_extension = '.siln' THEN 'Dev Ops'
        WHEN file_extension = '.spec' THEN 'Dev Ops'
        WHEN file_extension = '.targ' THEN 'Dev Ops'
        WHEN file_extension = '.targets' THEN 'Dev Ops'
        WHEN file_extension = '.template' THEN 'Dev Ops'
        WHEN file_extension = '.tgz' THEN 'Dev Ops'
        WHEN file_extension = '.todo' THEN 'Dev Ops'
        WHEN file_extension = '.txt' THEN 'Document'
        WHEN file_extension = '.un~' THEN 'Dev Ops'
        WHEN file_extension = '.vcxproj' THEN 'Dev Ops'
        WHEN file_extension = '.whitelist' THEN 'Dev Ops'
        WHEN file_extension = '.xclangspec' THEN 'Dev Ops'
        WHEN file_extension = '.yml' THEN 'Dev Ops'
        WHEN file_extension = '.1' THEN 'Document'
        WHEN file_extension = '.asc' THEN 'Document'
        WHEN file_extension = '.asciidoc' THEN 'Document'
        WHEN file_extension = '.base64' THEN 'Document'
        WHEN file_extension = '.csv' THEN 'Document'
        WHEN file_extension = '.doc' THEN 'Document'
        WHEN file_extension = '.DOCS' THEN 'Document'
        WHEN file_extension = '.docx' THEN 'Document'
        WHEN file_extension = '.dot' THEN 'Document'
        WHEN file_extension = '.drawio' THEN 'Document'
        WHEN file_extension = '.epub' THEN 'Document'
        WHEN file_extension = '.markdown' THEN 'Document'
        WHEN file_extension = '.MD' THEN 'Document'
        WHEN file_extension = '.md~' THEN 'Document'
        WHEN file_extension = '.odt' THEN 'Document'
        WHEN file_extension = '.pkg' THEN 'Document'
        WHEN file_extension = '.ppt' THEN 'Document'
        WHEN file_extension = '.pptx' THEN 'Document'
        WHEN file_extension = '.TXT' THEN 'Document'
        WHEN file_extension = '.xsd' THEN 'Document'
        WHEN file_extension = '.app' THEN 'Frontend'
        WHEN file_extension = '.atom' THEN 'Frontend'
        WHEN file_extension = '.auradoc' THEN 'Frontend'
        WHEN file_extension = '.cmp' THEN 'Frontend'
        WHEN file_extension = '.coffee' THEN 'Frontend'
        WHEN file_extension = '.component' THEN 'Frontend'
        WHEN file_extension = '.css' THEN 'Frontend'
        WHEN file_extension = '.design' THEN 'Frontend'
        WHEN file_extension = '.eot' THEN 'Frontend'
        WHEN file_extension = '.flexipage' THEN 'Frontend'
        WHEN file_extension = '.gif' THEN 'Image'
        WHEN file_extension = '.html' THEN 'Frontend'
        WHEN file_extension = '.ico' THEN 'Frontend'
        WHEN file_extension = '.jpeg' THEN 'Image'
        WHEN file_extension = '.jpg' THEN 'Image'
        WHEN file_extension = '.js' THEN 'Frontend'
        WHEN file_extension = '.labels' THEN 'Frontend'
        WHEN file_extension = '.layout' THEN 'Frontend'
        WHEN file_extension = '.map' THEN 'Frontend'
        WHEN file_extension = '.mdx' THEN 'Frontend'
        WHEN file_extension = '.module' THEN 'Frontend'
        WHEN file_extension = '.module~' THEN 'Frontend'
        WHEN file_extension = '.otf' THEN 'Frontend'
        WHEN file_extension = '.page' THEN 'Frontend'
        WHEN file_extension = '.pdf' THEN 'Document'
        WHEN file_extension = '.png' THEN 'Image'
        WHEN file_extension = '.po' THEN 'Frontend'
        WHEN file_extension = '.psd' THEN 'Frontend'
        WHEN file_extension = '.rst' THEN 'Frontend'
        WHEN file_extension = '.sample' THEN 'Other'
        WHEN file_extension = '.scss' THEN 'Frontend'
        WHEN file_extension = '.svg' THEN 'Image'
        WHEN file_extension = '.swf' THEN 'Frontend'
        WHEN file_extension = '.tab' THEN 'Frontend'
        WHEN file_extension = '.theme' THEN 'Frontend'
        WHEN file_extension = '.tmpl' THEN 'Frontend'
        WHEN file_extension = '.ttf' THEN 'Frontend'
        WHEN file_extension = '.twig' THEN 'Frontend'
        WHEN file_extension = '.twig--deleted' THEN 'Frontend'
        WHEN file_extension = '.woff' THEN 'Frontend'
        WHEN file_extension = '.woff2' THEN 'Frontend'
        WHEN file_extension = '.xlf' THEN 'Frontend'
        WHEN file_extension = '.ai' THEN 'Image'
        WHEN file_extension = '.eps' THEN 'Image'
        WHEN file_extension = '.JPG' THEN 'Image'
        WHEN file_extension = '.pict' THEN 'Image'
        WHEN file_extension = '.PNG' THEN 'Image'
        WHEN file_extension = '.ser' THEN 'Image'
        WHEN file_extension = '.svgz' THEN 'Image'
        WHEN file_extension = '.tiff' THEN 'Image'
        WHEN file_extension = '.webp' THEN 'Image'
        WHEN file_extension = '.avi' THEN 'Multimedia'
        WHEN file_extension = '.mov' THEN 'Multimedia'
        WHEN file_extension = '.mp4' THEN 'Multimedia'
        WHEN file_extension = '.mpg' THEN 'Multimedia'
        WHEN file_extension = '.ogv' THEN 'Multimedia'
        WHEN file_extension = '.peg' THEN 'Multimedia'
        WHEN file_extension = '.snap' THEN 'Multimedia'
        WHEN file_extension = '.webm' THEN 'Multimedia'
        WHEN file_extension = '.approvalProcess' THEN 'Process Automation'
        WHEN file_extension = '.email' THEN 'Process Automation'
        WHEN file_extension = '.evt' THEN 'Process Automation'
        WHEN file_extension = '.flow' THEN 'Process Automation'
        WHEN file_extension = '.pathAssistant' THEN 'Process Automation'
        WHEN file_extension = '.queue' THEN 'Process Automation'
        WHEN file_extension = '.quickAction' THEN 'Process Automation'
        WHEN file_extension = '.workflow' THEN 'Process Automation'
        WHEN file_extension = '.xml' THEN 'Configuration'
        WHEN file_extension = '.dashboard' THEN 'Reports'
        WHEN file_extension = '.report' THEN 'Reports'
        WHEN file_extension = '.reportType' THEN 'Reports'
        WHEN file_extension = '.bak' THEN 'Dev Ops'
        WHEN file_extension = '.feature' THEN 'Testing'
        WHEN file_extension = '.fixed' THEN 'Testing'
        WHEN file_extension = '.foo' THEN 'Testing'
        WHEN file_extension = '.geohash' THEN 'Testing'
        WHEN file_extension = '.georss' THEN 'Testing'
        WHEN file_extension = '.gpx' THEN 'Testing'
        WHEN file_extension = '.gz' THEN 'Dev Ops'
        WHEN file_extension = '.inc' THEN 'Testing'
        WHEN file_extension = '.kml' THEN 'Testing'
        WHEN file_extension = '.mo' THEN 'Testing'
        WHEN file_extension = '.painless' THEN 'Testing'
        WHEN file_extension = '.rar' THEN 'Testing'
        WHEN file_extension = '.rdf' THEN 'Testing'
        WHEN file_extension = '.rss2' THEN 'Testing'
        WHEN file_extension = '.rtf' THEN 'Document'
        WHEN file_extension = '.sass' THEN 'Testing'
        WHEN file_extension = '.save' THEN 'Testing'
        WHEN file_extension = '.script' THEN 'Testing'
        WHEN file_extension = '.skip' THEN 'Testing'
        WHEN file_extension = '.swo' THEN 'Testing'
        WHEN file_extension = '.swp' THEN 'Testing'
        WHEN file_extension = '.tar' THEN 'Dev Ops'
        WHEN file_extension = '.test' THEN 'Testing'
        WHEN file_extension = '.text' THEN 'Document'
        WHEN file_extension = '.ts' THEN 'Testing'
        WHEN file_extension = '.tsx' THEN 'Testing'
        WHEN file_extension = '.watchr' THEN 'Testing'
        WHEN file_extension = '.wsdl' THEN 'Backend'
        WHEN file_extension = '.assignmentRules' THEN 'Configuration'
        WHEN file_extension = '.autoResponseRules' THEN 'Configuration'
        WHEN file_extension = '.nlp' THEN 'Other'
        WHEN file_extension = '.pot' THEN 'Other'
        WHEN file_extension = '.ps1' THEN 'Other'
        WHEN file_extension = '.rej' THEN 'Other'
        WHEN file_extension = '.tpl' THEN 'Other'
        WHEN file_extension = '.wkb' THEN 'Other'
        WHEN file_extension = '.wkt' THEN 'Other'
        WHEN file_extension = '.xliff' THEN 'Other'
        WHEN file_extension = '.xml"' THEN 'Configuration'
        WHEN file_extension = '.xsl' THEN 'Configuration'
        WHEN file_extension = '.xtmpl' THEN 'Other'
        WHEN file_extension = '.zip' THEN 'Other'
        ELSE 'Other'
    END AS category
FROM commit_files_types cft;

CREATE OR REPLACE VIEW vw_technology_stack_complexity AS
SELECT vtsc.file_extension,
       vtsc.category,
       CASE
           WHEN vtsc.category = 'Frontend' THEN 3
           WHEN vtsc.category = 'Dev Ops' THEN 1
           WHEN vtsc.category = 'Configuration' THEN 1
           WHEN vtsc.category = 'Backend' THEN 3
           WHEN vtsc.category = 'Other' THEN 0
           WHEN vtsc.category = 'Process Automation' THEN 1
           WHEN vtsc.category = 'Testing' THEN 2
           WHEN vtsc.category = 'Database' THEN 3
           WHEN vtsc.category = 'Image' THEN 0
           WHEN vtsc.category = 'Reports' THEN 1
           WHEN vtsc.category = 'Document' THEN 0
           WHEN vtsc.category = 'Multimedia' THEN 1
           WHEN vtsc.category = 'Audio' THEN 0
       END AS complexity_multiplier
FROM vw_technology_stack_category vtsc
GROUP BY vtsc.file_extension, vtsc.category;

-- ============================================================================
-- Commit file change history view
-- ============================================================================

CREATE OR REPLACE VIEW vw_commit_file_chage_history AS
SELECT cf.sha,
       cc.team,
       cc.full_name,
       cf.filename,
       ch.commit_message,
       ch.branch,
       ch.is_merge,
       ch.commit_date,
       cf.is_test_file,
       ch.url,
       cc.vendor,
       cf.complexity,
       cf.total_comment_lines,
       cf.total_code_lines,
       COALESCE(cf.complexity - LAG(cf.complexity, 1) OVER (PARTITION BY cf.filename ORDER BY ch.commit_date), cf.complexity) AS complexity_change,
       COALESCE(cf.total_comment_lines - LAG(cf.total_comment_lines, 1) OVER (PARTITION BY cf.filename ORDER BY ch.commit_date), cf.total_comment_lines) AS comments_change,
       COALESCE(cf.total_code_lines - LAG(cf.total_code_lines, 1) OVER (PARTITION BY cf.filename ORDER BY ch.commit_date), cf.total_code_lines) AS code_change,
       vtsc.category,
       vtsc.complexity_multiplier
FROM commit_files cf
    INNER JOIN commit_history ch ON cf.sha = ch.sha
    LEFT JOIN commit_contributors cc ON cf.author = cc.login
    INNER JOIN vw_technology_stack_complexity vtsc ON cf.file_extension = vtsc.file_extension
WHERE NOT filename LIKE 'buildscript%'
  AND NOT filename IN ('src/classes/OneTimeScriptBatch.cls');

-- ============================================================================
-- Scorecard views
-- ============================================================================

CREATE OR REPLACE VIEW vw_scorecard_detail AS
SELECT scorecard_formula.full_name,
       scorecard_formula.team,
       scorecard_formula.vendor,
       SUM(scorecard_formula.release_assist)::NUMERIC(10,2) AS release_assist_score,
       SUM(scorecard_formula.test_change)::NUMERIC(10,2) AS test_score,
       SUM(scorecard_formula.adjusted_complexity_change)::NUMERIC(10,2) AS complexity_score,
       SUM(scorecard_formula.adjusted_comments_change)::NUMERIC(10,2) AS comments_score,
       SUM(scorecard_formula.adjusted_code_change)::NUMERIC(10,2) AS code_score
FROM (
    SELECT vcfch.full_name,
           vcfch.team,
           vcfch.vendor,
           CASE
               WHEN is_merge = TRUE THEN 1
               ELSE 0
           END AS release_assist,
           CASE
               WHEN is_test_file = TRUE THEN 1
               ELSE 0
           END AS test_change,
           CASE
               WHEN vcfch.complexity_change < -2 THEN 2 * vcfch.complexity_multiplier
               ELSE ABS(vcfch.complexity_change) * vcfch.complexity_multiplier
           END AS adjusted_complexity_change,
           CASE
               WHEN vcfch.comments_change < 0 THEN 0
               ELSE vcfch.comments_change
           END AS adjusted_comments_change,
           ABS(vcfch.code_change) * vcfch.complexity_multiplier AS adjusted_code_change
    FROM vw_commit_file_chage_history vcfch
) scorecard_formula
GROUP BY scorecard_formula.full_name, scorecard_formula.team, scorecard_formula.vendor;

CREATE OR REPLACE VIEW vw_scorecard AS
SELECT vsd.full_name,
       vsd.team,
       vsd.vendor,
       vsd.release_assist_score * (0.1) + vsd.test_score * (0.35) + vsd.complexity_score * (0.45) + vsd.comments_score * (0.1) AS total_score
FROM vw_scorecard_detail vsd
WHERE NOT vsd.vendor = 'Company';

-- ============================================================================
-- Jira history views
-- ============================================================================

CREATE OR REPLACE VIEW vw_jira_history_detail AS
SELECT jh.jira_key,
       jh.change_date,
       jh.field,
       jh.from_value,
       jh.to_value,
       jd.project,
       jd.points,
       jd.issuetype,
       CASE
           WHEN UPPER(jh.to_value) = 'IN PROGRESS' THEN jd.points
           WHEN UPPER(jh.to_value) = 'IN DEV' THEN jd.points
           WHEN UPPER(jh.to_value) = 'IN PROGRESS/DEVELOPMENT' THEN jd.points
           WHEN UPPER(jh.to_value) = 'ANALYSIS' THEN jd.points
           WHEN UPPER(jh.to_value) = 'DEFINED' THEN jd.points
           ELSE 0
       END AS in_dev,
       CASE
           WHEN UPPER(jh.to_value) = 'IN QA' THEN jd.points
           WHEN UPPER(jh.to_value) = 'IN UAT' THEN jd.points
           WHEN UPPER(jh.to_value) = 'IN UAT ENV' THEN jd.points
           WHEN UPPER(jh.to_value) = 'READY FOR QA' THEN jd.points
           ELSE 0
       END AS in_qa
FROM jira_history jh
    INNER JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    AND issuetype IN ('Bug', 'Story', 'Sub-task')
WHERE jh.field = 'status';

CREATE OR REPLACE VIEW vw_jira_history_assignments AS
SELECT jh.jira_key,
       jh.change_date,
       jh.field,
       jh.from_value,
       jh.to_value,
       jd.project,
       jd.points,
       jd.issuetype
FROM jira_history jh
    INNER JOIN jira_detail jd ON jh.jira_key = jd.jira_key
WHERE jh.field = 'assignee';
