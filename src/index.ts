import inquirer from 'inquirer';
import cliProgress from 'cli-progress';
import { BacklogClient } from './backlog-client';
import { processMarkdownHeaders } from './markdown-processor';
import { BacklogConfig, ProcessingStats } from './types';
import logger from './logger';

/**
 * Get user input for Backlog configuration
 */
async function getUserInput(): Promise<BacklogConfig> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'Enter your Backlog space (e.g., yourspace.backlog.com):',
      validate: (input: string) => {
        if (!input.trim()) return 'Backlog space is required';
        const trimmed = input.trim();
        // Check if it looks like a valid domain (hostname only, no protocol)
        if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
          return 'Please enter a valid Backlog space (e.g., yourspace.backlog.com)';
        }
        return true;
      }
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Backlog API key:',
      validate: (input: string) => {
        if (!input.trim()) return 'API key is required';
        return true;
      }
    },
    {
      type: 'input',
      name: 'projectCode',
      message: 'Enter the project code:',
      validate: (input: string) => {
        if (!input.trim()) return 'Project code is required';
        return true;
      }
    },
    {
      type: 'input',
      name: 'dryRunInput',
      message: 'Run in dry-run mode? (Preview changes without updating) [Y/n]:',
      default: 'Y',
      validate: (input: string) => {
        const normalized = input.toLowerCase().trim();
        if (['y', 'yes', 't', 'true', 'n', 'no', 'f', 'false', ''].includes(normalized)) {
          return true;
        }
        return 'Please enter y/yes/t/true for dry-run mode, or n/no/f/false for execution mode';
      }
    }
  ]);

  // Parse dry-run input
  const dryRunInput = answers.dryRunInput.toLowerCase().trim();
  const isDryRun = ['y', 'yes', 't', 'true', ''].includes(dryRunInput);

  return {
    host: answers.host.trim(),
    apiKey: answers.apiKey.trim(),
    projectCode: answers.projectCode.trim().toUpperCase(),
    dryRun: isDryRun
  };
}

/**
 * List issues that need header fixes (dry-run mode)
 */
async function listIssuesForUpdate(client: BacklogClient, projectId: number): Promise<ProcessingStats> {
  const stats: ProcessingStats = { total: 0, updated: 0, errors: 0 };

  try {
    const issues = await client.getIssues(projectId);
    stats.total = issues.length;

    if (issues.length === 0) {
      console.log('📝 No issues found in the project');
      logger.info('No issues found in the project');
      return stats;
    }

    console.log(`\n📝 Found ${issues.length} issues. Checking for header fixes needed...\n`);

    const progressBar = new cliProgress.SingleBar({
      format: 'Analyzing Issues  |{bar}| {percentage}% | {value}/{total} | {eta_formatted}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(issues.length, 0);

    const issuesNeedingUpdate: Array<{issue: any, changeCount: number}> = [];

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];

      try {
        // Get detailed issue information
        const detailedIssue = await client.getIssue(issue.id);

        // Process markdown headers (dry-run)
        const result = processMarkdownHeaders(detailedIssue.description, 'issue', issue.id);

        if (result.changed) {
          issuesNeedingUpdate.push({
            issue: detailedIssue,
            changeCount: result.changeCount
          });
          stats.updated++;
        }

        progressBar.update(i + 1);

        // Sleep for 1 second to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Error analyzing issue ${issue.issueKey}:`, error);
        stats.errors++;
        progressBar.update(i + 1);
      }
    }

    progressBar.stop();

    // Display results
    if (issuesNeedingUpdate.length > 0) {
      console.log(`\n🔧 Issues requiring header fixes (${issuesNeedingUpdate.length}):`);
      console.log('─'.repeat(80));
      
      issuesNeedingUpdate.forEach((item, index) => {
        console.log(`${index + 1}. ${item.issue.issueKey}: ${item.issue.summary}`);
        console.log(`   📍 ${item.changeCount} header(s) need fixing`);
        console.log('');
      });
    } else {
      console.log('\n✅ No issues require header fixes!');
    }

    return stats;
  } catch (error) {
    logger.error('Failed to analyze issues:', error);
    throw error;
  }
}

/**
 * Process all issues in the project
 */
async function processIssues(client: BacklogClient, projectId: number): Promise<ProcessingStats> {
  const stats: ProcessingStats = { total: 0, updated: 0, errors: 0 };

  try {
    const issues = await client.getIssues(projectId);
    stats.total = issues.length;

    if (issues.length === 0) {
      logger.info('No issues found in the project');
      return stats;
    }

    const progressBar = new cliProgress.SingleBar({
      format: 'Processing Issues |{bar}| {percentage}% | {value}/{total} | {eta_formatted}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(issues.length, 0);

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      
      try {
        // Get detailed issue information
        const detailedIssue = await client.getIssue(issue.id);
        
        // Process markdown headers
        const result = processMarkdownHeaders(detailedIssue.description, 'issue', issue.id);
        
        if (result.changed) {
          await client.updateIssue(issue.id, result.content);
          stats.updated++;
          
          // Sleep for 1 second as specified in requirements
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        progressBar.update(i + 1);
      } catch (error) {
        logger.error(`Error processing issue ${issue.issueKey}:`, error);
        stats.errors++;
        progressBar.update(i + 1);
      }
    }

    progressBar.stop();
    return stats;
  } catch (error) {
    logger.error('Failed to process issues:', error);
    throw error;
  }
}

/**
 * List wikis that need header fixes (dry-run mode)
 */
async function listWikisForUpdate(client: BacklogClient, projectId: number): Promise<ProcessingStats> {
  const stats: ProcessingStats = { total: 0, updated: 0, errors: 0 };

  try {
    const wikis = await client.getWikis(projectId);
    stats.total = wikis.length;

    if (wikis.length === 0) {
      console.log('📝 No wikis found in the project');
      logger.info('No wikis found in the project');
      return stats;
    }

    console.log(`\n📝 Found ${wikis.length} wikis. Checking for header fixes needed...\n`);

    const progressBar = new cliProgress.SingleBar({
      format: 'Analyzing Wikis   |{bar}| {percentage}% | {value}/{total} | {eta_formatted}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(wikis.length, 0);

    const wikisNeedingUpdate: Array<{wiki: any, changeCount: number}> = [];

    for (let i = 0; i < wikis.length; i++) {
      const wiki = wikis[i];

      try {
        // Get detailed wiki information
        const detailedWiki = await client.getWiki(wiki.id);

        // Process markdown headers (dry-run)
        const result = processMarkdownHeaders(detailedWiki.content, 'wiki', wiki.id);

        if (result.changed) {
          wikisNeedingUpdate.push({
            wiki: detailedWiki,
            changeCount: result.changeCount
          });
          stats.updated++;
        }

        progressBar.update(i + 1);

        // Sleep for 1 second to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Error analyzing wiki ${wiki.name}:`, error);
        stats.errors++;
        progressBar.update(i + 1);
      }
    }

    progressBar.stop();

    // Display results
    if (wikisNeedingUpdate.length > 0) {
      console.log(`\n🔧 Wikis requiring header fixes (${wikisNeedingUpdate.length}):`);
      console.log('─'.repeat(80));
      
      wikisNeedingUpdate.forEach((item, index) => {
        console.log(`${index + 1}. ${item.wiki.name}`);
        console.log(`   📍 ${item.changeCount} header(s) need fixing`);
        console.log('');
      });
    } else {
      console.log('\n✅ No wikis require header fixes!');
    }

    return stats;
  } catch (error) {
    logger.error('Failed to analyze wikis:', error);
    throw error;
  }
}

/**
 * Process all wikis in the project
 */
async function processWikis(client: BacklogClient, projectId: number): Promise<ProcessingStats> {
  const stats: ProcessingStats = { total: 0, updated: 0, errors: 0 };

  try {
    const wikis = await client.getWikis(projectId);
    stats.total = wikis.length;

    if (wikis.length === 0) {
      logger.info('No wikis found in the project');
      return stats;
    }

    const progressBar = new cliProgress.SingleBar({
      format: 'Processing Wikis  |{bar}| {percentage}% | {value}/{total} | {eta_formatted}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    progressBar.start(wikis.length, 0);

    for (let i = 0; i < wikis.length; i++) {
      const wiki = wikis[i];
      
      try {
        // Get detailed wiki information
        const detailedWiki = await client.getWiki(wiki.id);
        
        // Process markdown headers
        const result = processMarkdownHeaders(detailedWiki.content, 'wiki', wiki.id);
        
        if (result.changed) {
          await client.updateWiki(wiki.id, result.content);
          stats.updated++;
          
          // Sleep for 1 second to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        progressBar.update(i + 1);
      } catch (error) {
        logger.error(`Error processing wiki ${wiki.name}:`, error);
        stats.errors++;
        progressBar.update(i + 1);
      }
    }

    progressBar.stop();
    return stats;
  } catch (error) {
    logger.error('Failed to process wikis:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('🚀 Backlog to GFM Markdown Migration Tool');
    console.log('==========================================\n');

    logger.info('Starting Backlog to GFM migration');

    // Get user input
    const config = await getUserInput();
    logger.info(`Processing project: ${config.projectCode} (dry-run: ${config.dryRun})`);

    // Initialize Backlog client
    const client = new BacklogClient(config);

    // Validate project and check if it uses markdown
    console.log('\n📋 Validating project...');
    const project = await client.getProject(config.projectCode);
    console.log(`✅ Project validated: ${project.name} (uses markdown formatting)`);

    if (config.dryRun) {
      console.log('\n🔍 DRY-RUN MODE: Analyzing items that need header fixes...');
      logger.info('Running in dry-run mode - no changes will be made');

      // Analyze issues
      console.log('\n🔍 Analyzing issues...');
      logger.info('Starting issue analysis...');
      const issueStats = await listIssuesForUpdate(client, project.id);
      logger.info(`Issues analyzed: ${issueStats.total}, Need updates: ${issueStats.updated}, Errors: ${issueStats.errors}`);

      // Analyze wikis
      console.log('\n📚 Analyzing wikis...');
      logger.info('Starting wiki analysis...');
      const wikiStats = await listWikisForUpdate(client, project.id);
      logger.info(`Wikis analyzed: ${wikiStats.total}, Need updates: ${wikiStats.updated}, Errors: ${wikiStats.errors}`);

      // Summary
      const totalNeedingUpdate = issueStats.updated + wikiStats.updated;
      const totalErrors = issueStats.errors + wikiStats.errors;
      
      console.log('\n📊 DRY-RUN SUMMARY');
      console.log('═'.repeat(50));
      console.log(`📝 Total items analyzed: ${issueStats.total + wikiStats.total}`);
      console.log(`🔧 Items needing header fixes: ${totalNeedingUpdate}`);
      console.log(`❌ Analysis errors: ${totalErrors}`);
      console.log('\n💡 To apply these changes, run again and select "No" for dry-run mode.');
      
      logger.info('Dry-run analysis completed');
      logger.info(`Final summary: ${totalNeedingUpdate} items need updates, ${totalErrors} errors`);
    } else {
      // Process issues
      console.log('\n🔍 Processing issues...');
      logger.info('Starting issue processing...');
      const issueStats = await processIssues(client, project.id);
      console.log(`✅ Issues processed: ${issueStats.total}, Updated: ${issueStats.updated}, Errors: ${issueStats.errors}`);
      logger.info(`Issues processed: ${issueStats.total}, Updated: ${issueStats.updated}, Errors: ${issueStats.errors}`);

      // Process wikis
      console.log('\n📚 Processing wikis...');
      logger.info('Starting wiki processing...');
      const wikiStats = await processWikis(client, project.id);
      console.log(`✅ Wikis processed: ${wikiStats.total}, Updated: ${wikiStats.updated}, Errors: ${wikiStats.errors}`);
      logger.info(`Wikis processed: ${wikiStats.total}, Updated: ${wikiStats.updated}, Errors: ${wikiStats.errors}`);

      // Summary
      const totalUpdated = issueStats.updated + wikiStats.updated;
      const totalErrors = issueStats.errors + wikiStats.errors;
      
      console.log('\n🎉 Migration completed!');
      console.log(`📊 Summary: ${totalUpdated} items updated, ${totalErrors} errors`);
      console.log('📝 Check migration.log for detailed logs');
      
      logger.info('Migration completed successfully');
      logger.info(`Final summary: ${totalUpdated} items updated, ${totalErrors} errors`);
    }

  } catch (error) {
    logger.error('Migration failed:', error);
    console.error('\n❌ Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the main function
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error:', error);
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

export { main };
