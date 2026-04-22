import * as core from '@actions/core'
import {getReporter, resolveConfig} from './resolve-config'
import * as synthetics from '@datadog/datadog-ci-plugin-synthetics'
import axios, {isAxiosError} from 'axios'
import * as fs from 'fs'

async function validateSubscription(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'DataDog/synthetics-ci-github-action'
  const action = process.env.GITHUB_ACTION_REPOSITORY
  const docsUrl =
    'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

  core.info('')
  core.info('[1;36mStepSecurity Maintained Action[0m')
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false)
    core.info('[32m✓ Free for public repositories[0m')
  core.info(`[36mLearn more:[0m ${docsUrl}`)
  core.info('')

  if (repoPrivate === false) return

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
  const body: Record<string, string> = {action: action || ''}
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      {timeout: 3000}
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `[1;31mThis action requires a StepSecurity subscription for private repositories.[0m`
      )
      core.error(
        `[31mLearn how to enable a subscription: ${docsUrl}[0m`
      )
      process.exit(1)
    }
    core.info('Timeout or API not reachable. Continuing to next step.')
  }
}

const run = async (): Promise<void> => {
  await validateSubscription()
  synthetics.utils.setCiTriggerApp('github_action')

  const reporter = getReporter()
  const config = await resolveConfig(reporter)
  const startTime = Date.now()

  try {
    const {results, summary} = await synthetics.executeTests(reporter, config)
    const orgSettings = await synthetics.utils.getOrgSettings(reporter, config)

    synthetics.utils.renderResults({
      config,
      orgSettings,
      reporter,
      results,
      startTime,
      summary,
    })

    synthetics.utils.reportExitLogs(reporter, config, {results})

    const baseUrl = synthetics.utils.getAppBaseURL(config)
    const batchUrl = synthetics.utils.getBatchUrl(baseUrl, summary.batchId)

    setOutputs(results, summary, batchUrl)

    const exitReason = synthetics.utils.getExitReason(config, {results})
    if (exitReason !== 'passed') {
      core.setFailed(`Datadog Synthetics tests failed: ${getTextSummary(summary, batchUrl)}`)
    } else {
      core.info(`Datadog Synthetics tests succeeded: ${getTextSummary(summary, batchUrl)}`)
    }
  } catch (error) {
    synthetics.utils.reportExitLogs(reporter, config, {error})

    const exitReason = synthetics.utils.getExitReason(config, {error})
    if (exitReason !== 'passed') {
      core.setFailed('Running Datadog Synthetics tests failed.')
    }
  }
}

const getTextSummary = (summary: synthetics.Summary, batchUrl: string): string =>
  `criticalErrors: ${summary.criticalErrors}, passed: ${summary.passed}, previouslyPassed: ${summary.previouslyPassed}, failedNonBlocking: ${summary.failedNonBlocking}, failed: ${summary.failed}, skipped: ${summary.skipped}, notFound: ${summary.testsNotFound.size}, timedOut: ${summary.timedOut}\n` +
  `Batch URL: ${batchUrl}`

const setOutputs = (results: synthetics.Result[], summary: synthetics.Summary, batchUrl: string): void => {
  core.setOutput('batch-url', batchUrl)
  core.setOutput('critical-errors-count', summary.criticalErrors)
  core.setOutput('failed-count', summary.failed)
  core.setOutput('failed-non-blocking-count', summary.failedNonBlocking)
  core.setOutput('passed-count', summary.passed)
  core.setOutput('previously-passed-count', summary.previouslyPassed)
  core.setOutput('tests-not-found-count', summary.testsNotFound.size)
  core.setOutput('tests-skipped-count', summary.skipped)
  core.setOutput('timed-out-count', summary.timedOut)
  core.setOutput('raw-results', JSON.stringify(results))
}

if (require.main === module) {
  run()
}

export default run

// Force embed of version in build files from package.json for release check
/* eslint-disable */
require('../package.json').name
require('../package.json').version
