import { Backlog } from 'backlog-js';
import { BacklogConfig, BacklogProject, BacklogIssue, BacklogWiki } from './types';
import logger from './logger';

export class BacklogClient {
  private client: any;
  private config: BacklogConfig;

  constructor(config: BacklogConfig) {
    this.config = config;
    this.client = new Backlog({
      host: config.host,
      apiKey: config.apiKey
    });
  }

  /**
   * Get project information and validate it uses markdown
   */
  async getProject(projectKey: string): Promise<BacklogProject> {
    try {
      logger.debug(`Fetching project: ${projectKey}`);
      const project = await this.client.getProject(projectKey);
      
      if (project.textFormattingRule !== 'markdown') {
        throw new Error(`Project ${projectKey} does not use markdown formatting (uses: ${project.textFormattingRule})`);
      }

      logger.info(`Project validated: ${project.name} (ID: ${project.id}) uses markdown`);
      return {
        id: project.id,
        projectKey: project.projectKey,
        name: project.name,
        textFormattingRule: project.textFormattingRule
      };
    } catch (error) {
      logger.error(`Failed to get project ${projectKey}:`, error);
      throw error;
    }
  }

  /**
   * Get all issues for a project with pagination
   */
  async getIssues(projectId: number): Promise<BacklogIssue[]> {
    try {
      logger.debug(`Fetching all issues for project ID: ${projectId}`);
      
      const allIssues: BacklogIssue[] = [];
      let offset = 0;
      const count = 100; // Maximum count per request
      let hasMoreIssues = true;

      while (hasMoreIssues) {
        logger.debug(`Fetching issues with offset: ${offset}, count: ${count}`);
        
        const issues = await this.client.getIssues({ 
          projectId: [projectId],
          offset: offset,
          count: count
        });
        
        if (issues.length === 0) {
          hasMoreIssues = false;
          break;
        }

        const mappedIssues = issues.map((issue: any) => ({
          id: issue.id,
          issueKey: issue.issueKey,
          summary: issue.summary,
          description: issue.description || ''
        }));

        allIssues.push(...mappedIssues);
        
        logger.debug(`Fetched ${issues.length} issues (total so far: ${allIssues.length})`);
        
        // If we got fewer issues than requested, we've reached the end
        if (issues.length < count) {
          hasMoreIssues = false;
        } else {
          offset += count;
        }
      }
      
      logger.info(`Found total ${allIssues.length} issues for project ${projectId}`);
      return allIssues;
    } catch (error) {
      logger.error(`Failed to get issues for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Retry mechanism for API calls with exponential backoff
   */
  private async retryApiCall<T>(
    apiCall: () => Promise<T>,
    operation: string,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a rate limit error
        if (error.message && error.message.includes('Too Many Requests')) {
          const waitTime = 15000; // Always wait 15 seconds for rate limit errors
          logger.warn(`${operation} rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries + 1}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Get detailed issue information
   */
  async getIssue(issueId: number): Promise<BacklogIssue> {
    return this.retryApiCall(async () => {
      logger.debug(`Fetching issue details: ${issueId}`);
      const issue = await this.client.getIssue(issueId);
      
      return {
        id: issue.id,
        issueKey: issue.issueKey,
        summary: issue.summary,
        description: issue.description || ''
      };
    }, `getIssue(${issueId})`);
  }

  /**
   * Update an issue's description
   */
  async updateIssue(issueId: number, description: string): Promise<void> {
    return this.retryApiCall(async () => {
      logger.debug(`Updating issue ${issueId}`);
      await this.client.patchIssue(issueId, {
        description: description
      });
      logger.info(`Successfully updated issue ${issueId}`);
    }, `updateIssue(${issueId})`);
  }

  /**
   * Get all wikis for a project
   */
  async getWikis(projectId: number): Promise<BacklogWiki[]> {
    try {
      logger.debug(`Fetching wikis for project ID: ${projectId}`);
      const wikis = await this.client.getWikis({ projectIdOrKey: projectId });
      
      logger.info(`Found ${wikis.length} wikis`);
      return wikis.map((wiki: any) => ({
        id: wiki.id,
        name: wiki.name,
        content: wiki.content || ''
      }));
    } catch (error) {
      logger.error(`Failed to get wikis for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed wiki information
   */
  async getWiki(wikiId: number): Promise<BacklogWiki> {
    return this.retryApiCall(async () => {
      logger.debug(`Fetching wiki details: ${wikiId}`);
      const wiki = await this.client.getWiki(wikiId);
      
      return {
        id: wiki.id,
        name: wiki.name,
        content: wiki.content || ''
      };
    }, `getWiki(${wikiId})`);
  }

  /**
   * Update a wiki's content
   */
  async updateWiki(wikiId: number, content: string): Promise<void> {
    return this.retryApiCall(async () => {
      logger.debug(`Updating wiki ${wikiId}`);
      await this.client.patchWiki(wikiId, {
        content
      });
      logger.info(`Successfully updated wiki ${wikiId}`);
    }, `updateWiki(${wikiId})`);
  }
}
