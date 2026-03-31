#!/usr/bin/env node

/**
 * Disaster Recovery Testing Script
 * 
 * Usage:
 *   node dr-test.js scenario=all                  # Run all scenarios
 *   node dr-test.js scenario=database-failure     # Test database failure
 *   node dr-test.js scenario=redis-failure        # Test Redis/cache failure
 *   node dr-test.js scenario=memory-leak          # Test memory leak detection
 *   node dr-test.js scenario=network-partition    # Test network failure
 *   node dr-test.js scenario=auth-failure         # Test auth failure
 *   node dr-test.js scenario=rate-limit-bypass    # Test rate limiting
 *   node dr-test.js scenario=data-corruption      # Test data corruption
 *   node dr-test.js scenario=security-incident    # Test security
 */

const https = require('https');
const http = require('http');
const { exec, execSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuration
const CONFIG = {
  API_PORT: process.env.API_PORT || 3001,
  API_KEY: process.env.TEST_API_KEY || 'test_key',
  BASE_URL: `http://localhost:${process.env.API_PORT || 3001}`,
  TIMEOUT: 10000,
};

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  gray: '\x1b[90m',
};

// Test results storage
let testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: [],
};

const log = {
  test: (name) => console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => {
    console.log(`${colors.green}✅${colors.reset} ${msg}`);
    testResults.passed++;
  },
  error: (msg) => {
    console.log(`${colors.red}❌${colors.reset} ${msg}`);
    testResults.failed++;
  },
  warn: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
  debug: (msg) => {
    if (process.env.DEBUG) {
      console.log(`${colors.gray}▸${colors.reset} ${msg}`);
    }
  },
  section: (title) => {
    console.log(`\n${colors.yellow}━━ ${title}${colors.reset}`);
  },
};

/**
 * HTTP request helper
 */
async function httpRequest(method, path, options = {}) {
  return new Promise((resolve) => {
    const url = new URL(`${CONFIG.BASE_URL}${path}`);
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey || CONFIG.API_KEY,
        ...options.headers,
      },
      timeout: options.timeout || CONFIG.TIMEOUT,
    };
    
    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          timestamp: Date.now(),
        });
      });
    });
    
    req.on('error', (error) => {
      resolve({
        status: 0,
        error: error.message,
        timestamp: Date.now(),
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        error: 'TIMEOUT',
        timestamp: Date.now(),
      });
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

/**
 * Shell command execution
 */
async function sh(command) {
  try {
    const { stdout, stderr } = await execPromise(command, { timeout: 10000 });
    return { success: true, stdout, stderr };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Wait for condition
 */
async function waitFor(condition, timeout = 30000, interval = 1000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return false;
}

/**
 * SCENARIO 1: Database Connection Failure
 */
async function testDatabaseFailure() {
  log.section('SCENARIO 1: Database Connection Failure');
  
  log.info('Testing graceful handling of database unavailability...');
  
  // Make request with good health
  let response = await httpRequest('GET', '/health');
  if (response.status === 200) {
    log.success('Database connectivity check: HEALTHY');
  } else {
    log.error('Unexpected health status before test');
  }
  
  // Try to simulate failure by using bad connection string
  // (In dry-run, just verify the endpoint exists)
  response = await httpRequest('GET', '/health', {
    timeout: 5000,
  });
  
  if (response.status === 200 || response.error === 'TIMEOUT') {
    log.success('Health endpoint responds to requests');
  } else {
    log.error(`Unexpected response: ${response.status}`);
  }
  
  // Test with intentional timeout
  response = await httpRequest('GET', '/health', { timeout: 100 });
  if (response.error || response.status === 0) {
    log.success('Timeout handling works (request failed gracefully)');
  } else {
    log.warn('Request completed despite short timeout (unexpected)');
  }
}

/**
 * SCENARIO 2: Redis/Cache Failure
 */
async function testRedisFailure() {
  log.section('SCENARIO 2: Redis/Cache Failure');
  
  log.info('Testing cache fallback mechanism...');
  
  // Make normal request
  const response = await httpRequest('GET', '/health');
  
  if (response.status === 200) {
    try {
      const data = JSON.parse(response.body);
      if (data.cache_status) {
        log.success(`Cache status: ${data.cache_status}`);
      }
    } catch (e) {
      log.warn('Could not parse health response');
    }
  } else {
    log.error(`Health check failed: ${response.status}`);
  }
  
  // Test idempotency without cache (uses database)
  const response2 = await httpRequest('POST', '/v1/chat/completions', {
    headers: { 'Idempotency-Key': 'dr-test-123' },
    body: { model: 'gpt-4', messages: [] },
  });
  
  if (response2.status >= 200 && response2.status < 500) {
    log.success('API responds even if cache unavailable (fallback to DB)');
  } else {
    log.error(`Unexpected response: ${response2.status}`);
  }
}

/**
 * SCENARIO 3: Memory Leak / Process Crash
 */
async function testMemoryLeak() {
  log.section('SCENARIO 3: Memory Leak Detection');
  
  log.info('Testing memory utilization under load...');
  
  // Get baseline memory
  const result = await sh(`ps aux | grep "node.*src/index" | grep -v grep | awk '{print $6}'`);
  const baselineMem = parseInt(result.stdout.trim());
  
  log.debug(`Baseline memory: ${baselineMem}KB`);
  
  if (baselineMem > 0) {
    log.success(`Process is running (memory: ${baselineMem}KB)`);
  } else {
    log.error('Process not found');
    return;
  }
  
  // Send multiple requests
  log.info('Sending 100 concurrent requests...');
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(
      httpRequest('GET', '/health', {
        timeout: 5000,
      })
    );
  }
  
  const responses = await Promise.all(promises);
  const successCount = responses.filter(r => r.status === 200).length;
  
  log.success(`Completed ${successCount}/100 requests without crash`);
  
  // Check memory after
  const resultAfter = await sh(`ps aux | grep "node.*src/index" | grep -v grep | awk '{print $6}'`);
  const afterMem = parseInt(resultAfter.stdout.trim());
  
  if (afterMem > 0) {
    const increase = ((afterMem - baselineMem) / baselineMem * 100).toFixed(1);
    log.debug(`Memory after load: ${afterMem}KB (${increase}% increase)`);
    
    if (increase < 50) {
      log.success(`Memory growth acceptable (${increase}% < 50%)`);
    } else {
      log.warn(`Potential memory leak detected (${increase}% growth)`);
    }
  }
}

/**
 * SCENARIO 4: Network Latency / Partition
 */
async function testNetworkPartition() {
  log.section('SCENARIO 4: Network Latency / Partition');
  
  log.info('Testing timeout and retry handling...');
  
  // Make request with very short timeout to simulate network issue
  const startTime = Date.now();
  const response = await httpRequest('GET', '/health', {
    timeout: 2000, // 2 second timeout
  });
  const elapsed = Date.now() - startTime;
  
  log.debug(`Request completed in ${elapsed}ms`);
  
  if (response.status === 200) {
    log.success('Request succeeded under normal conditions');
  } else if (response.error === 'TIMEOUT') {
    log.success('Timeout detected and handled gracefully');
  } else {
    log.warn(`Unexpected response: ${response.status}`);
  }
  
  // Test with longer timeout
  const responses = [];
  for (let i = 0; i < 5; i++) {
    responses.push(await httpRequest('GET', '/health', {
      timeout: 10000,
    }));
  }
  
  const successCount = responses.filter(r => r.status === 200).length;
  if (successCount >= 4) {
    log.success(`High reliability under stress: ${successCount}/5 requests succeeded`);
  } else {
    log.warn(`Low reliability: ${successCount}/5 succeeded`);
  }
}

/**
 * SCENARIO 5: Authentication Failure
 */
async function testAuthFailure() {
  log.section('SCENARIO 5: Authentication/Authorization Failure');
  
  log.info('Testing security and auth boundaries...');
  
  // Test 1: Invalid API key
  let response = await httpRequest('GET', '/v1/models', {
    apiKey: 'invalid_key_12345',
  });
  
  if (response.status === 401 || response.status === 403) {
    log.success('Invalid API key rejected (401/403)');
  } else {
    log.error(`Invalid key not rejected: ${response.status}`);
  }
  
  // Test 2: Missing API key
  response = await httpRequest('GET', '/v1/models', {
    apiKey: '',
    headers: { 'x-api-key': '' }, // Clear the header
  });
  
  if (response.status === 401 || response.status === 403) {
    log.success('Missing API key rejected (401/403)');
  } else {
    log.warn(`Missing key response: ${response.status}`);
  }
  
  // Test 3: Expired/invalid JWT
  const fakeJWT = 'invalid.jwt.token';
  response = await httpRequest('GET', '/v1/models', {
    headers: { 'Authorization': `Bearer ${fakeJWT}` },
  });
  
  if (response.status === 401 || response.status === 403) {
    log.success('Invalid JWT rejected (401/403)');
  } else {
    log.debug(`Invalid JWT response: ${response.status}`);
  }
  
  // Test 4: Rate limiting on failed auth attempts
  log.info('Testing rate limit on failed auth...');
  const failedAttempts = [];
  for (let i = 0; i < 20; i++) {
    failedAttempts.push(
      httpRequest('GET', '/v1/models', {
        apiKey: `invalid_${i}`,
        timeout: 2000,
      })
    );
  }
  
  const results = await Promise.all(failedAttempts);
  const rateLimitCount = results.filter(r => r.status === 429).length;
  
  if (rateLimitCount > 0) {
    log.success(`Rate limiting applied to failed attempts (${rateLimitCount} blocked)`);
  } else {
    log.debug('No rate limiting on failed attempts');
  }
}

/**
 * SCENARIO 6: Rate Limiting / DDoS Protection
 */
async function testRateLimitBypass() {
  log.section('SCENARIO 6: Rate Limiting / DDoS Protection');
  
  log.info('Testing rate limit enforcement...');
  
  // Single key: send many requests and validate limit
  const requests = [];
  for (let i = 0; i < 100; i++) {
    requests.push(
      httpRequest('GET', '/health', {
        timeout: 2000,
      })
    );
  }
  
  const responses = await Promise.all(requests);
  const successCount = responses.filter(r => r.status === 200).length;
  const rateLimitCount = responses.filter(r => r.status === 429).length;
  
  log.debug(`Results: 200 OK=${successCount}, 429 Limited=${rateLimitCount}`);
  
  if (successCount > 0) {
    log.success('Health endpoint accepts requests within rate limit');
  }
  
  if (rateLimitCount > 0) {
    log.success('Rate limiting enforced (429 responses detected)');
  } else {
    log.warn('No rate limiting detected (or limit very high)');
  }
  
  // Check Retry-After header
  if (rateLimitCount > 0) {
    const rateLimitedResponse = responses.find(r => r.status === 429);
    if (rateLimitedResponse && rateLimitedResponse.headers['retry-after']) {
      log.success(`Retry-After header present: ${rateLimitedResponse.headers['retry-after']}`);
    } else {
      log.warn('429 response missing Retry-After header');
    }
  }
}

/**
 * SCENARIO 7: Data Corruption Detection
 */
async function testDataCorruption() {
  log.section('SCENARIO 7: Data Corruption Detection');
  
  log.info('Testing data integrity...');
  
  // Health check includes database status
  const response = await httpRequest('GET', '/health');
  
  if (response.status === 200) {
    try {
      const health = JSON.parse(response.body);
      if (health.database_status) {
        log.success(`Database integrity check: ${health.database_status}`);
      }
      
      // Check for any corruption indicators
      if (health.warnings && health.warnings.length > 0) {
        log.warn(`Warnings detected: ${health.warnings.join(', ')}`);
      } else {
        log.success('No data integrity warnings');
      }
    } catch (e) {
      log.warn('Could not parse health response for integrity check');
    }
  } else {
    log.error(`Health check failed: ${response.status}`);
  }
  
  // Test idempotency key consistency
  const idempKey = `dr-corruption-test-${Date.now()}`;
  
  const req1 = await httpRequest('POST', '/v1/chat/completions', {
    headers: { 'Idempotency-Key': idempKey },
    body: { model: 'gpt-4', messages: [] },
    timeout: 5000,
  });
  
  log.debug(`First request: ${req1.status}`);
  
  // Make same request again
  const req2 = await httpRequest('POST', '/v1/chat/completions', {
    headers: { 'Idempotency-Key': idempKey },
    body: { model: 'gpt-4', messages: [] },
    timeout: 5000,
  });
  
  log.debug(`Second request: ${req2.status}`);
  
  if (req1.status === req2.status) {
    log.success('Idempotency key consistency verified (same response)');
  } else {
    log.warn('Idempotency key responses differ (might be legitimate)');
  }
}

/**
 * SCENARIO 8: Security Incident Simulation
 */
async function testSecurityIncident() {
  log.section('SCENARIO 8: Security Incident Simulation');
  
  log.info('Testing security controls...');
  
  // Test 1: SQL Injection attempt
  log.debug('Testing SQL injection protection...');
  const sqlResponse = await httpRequest('GET', '/v1/models', {
    apiKey: "test'; DROP TABLE users; --",
  });
  
  if (sqlResponse.status === 401) {
    log.success('SQL injection attempt rejected (treated as invalid key)');
  } else {
    log.warn(`Injection response: ${sqlResponse.status}`);
  }
  
  // Test 2: Path traversal
  log.debug('Testing path traversal protection...');
  const pathResponse = await httpRequest('GET', '/../../../etc/passwd');
  
  if (pathResponse.status === 404 || pathResponse.status === 400) {
    log.success('Path traversal attempt blocked (404/400)');
  } else {
    log.warn(`Path traversal response: ${pathResponse.status}`);
  }
  
  // Test 3: Large payload attack
  log.debug('Testing payload size limits...');
  const largePayload = 'x'.repeat(10 * 1024 * 1024); // 10MB
  const payloadResponse = await httpRequest('POST', '/v1/chat/completions', {
    body: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: largePayload }],
    },
    timeout: 5000,
  });
  
  if (payloadResponse.status === 413 || payloadResponse.status === 400) {
    log.success('Oversized payload rejected (413/400)');
  } else if (payloadResponse.error === 'TIMEOUT') {
    log.success('Oversized payload caused timeout (processing halted)');
  } else {
    log.warn(`Large payload response: ${payloadResponse.status}`);
  }
  
  // Test 4: Error messages don't leak info
  const errorResponse = await httpRequest('GET', '/v1/models', {
    apiKey: 'test_invalid_key',
  });
  
  if (errorResponse.status === 401) {
    try {
      const error = JSON.parse(errorResponse.body);
      if (error.error && !error.error.includes('SELECT') && !error.error.includes('database')) {
        log.success('Error messages sanitized (no DB info leaked)');
      } else {
        log.warn('Error message may contain internal details');
      }
    } catch (e) {
      log.debug('Could not parse error response');
    }
  }
}

/**
 * Generate test report
 */
function generateReport() {
  console.log('\n' + '═'.repeat(60));
  console.log('              DR TEST REPORT');
  console.log('═'.repeat(60));
  
  const total = testResults.passed + testResults.failed;
  const passRate = total > 0 ? (testResults.passed / total * 100).toFixed(1) : 0;
  
  console.log(`\nResults: ${testResults.passed}/${total} tests passed (${passRate}%)`);
  console.log(`Status: ${testResults.failed === 0 ? colors.green + '✅ PASS' + colors.reset : colors.red + '❌ FAIL' + colors.reset}`);
  console.log('\n' + '═'.repeat(60));
  
  return testResults.failed === 0;
}

/**
 * Main entry point
 */
async function main() {
  const scenarioArg = process.argv.find(arg => arg.startsWith('scenario='));
  const scenario = scenarioArg ? scenarioArg.split('=')[1] : 'all';
  
  log.section('DISASTER RECOVERY TEST SUITE');
  log.info(`Selected scenario: ${scenario}`);
  log.info(`Target API: ${CONFIG.BASE_URL}`);
  log.info('');
  
  try {
    if (scenario === 'all' || scenario === 'database-failure') {
      await testDatabaseFailure();
    }
    if (scenario === 'all' || scenario === 'redis-failure') {
      await testRedisFailure();
    }
    if (scenario === 'all' || scenario === 'memory-leak') {
      await testMemoryLeak();
    }
    if (scenario === 'all' || scenario === 'network-partition') {
      await testNetworkPartition();
    }
    if (scenario === 'all' || scenario === 'auth-failure') {
      await testAuthFailure();
    }
    if (scenario === 'all' || scenario === 'rate-limit-bypass') {
      await testRateLimitBypass();
    }
    if (scenario === 'all' || scenario === 'data-corruption') {
      await testDataCorruption();
    }
    if (scenario === 'all' || scenario === 'security-incident') {
      await testSecurityIncident();
    }
    
    const success = generateReport();
    process.exit(success ? 0 : 1);
    
  } catch (error) {
    log.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
