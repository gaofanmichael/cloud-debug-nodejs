/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

import {DebugAgentConfig} from '../src/agent/config';

import * as _ from 'lodash';
import * as path from 'path';
import * as assert from 'assert';
import DEFAULT_CONFIG from '../src/agent/config';
(DEFAULT_CONFIG as any).allowExpressions = true;
(DEFAULT_CONFIG as any).workingDirectory = path.join(__dirname, '..');
import {Debuglet} from '../src/agent/debuglet';
import * as dns from 'dns';
import * as extend from 'extend';
const metadata: {project: any, instance: any} = require('gcp-metadata');
import {Debug} from '../src/debug';

const DEBUGGEE_ID = 'bar';
const API = 'https://clouddebugger.googleapis.com';
const REGISTER_PATH = '/v2/controller/debuggees/register';
const BPS_PATH = '/v2/controller/debuggees/' + DEBUGGEE_ID + '/breakpoints';
const EXPRESSIONS_REGEX =
    /Expressions and conditions are not allowed.*https:\/\/goo\.gl\/ShSm6r/;

const fakeCredentials = require('./fixtures/gcloud-credentials.json');

const nock = require('nock');
const nocks = require('./nocks.js');
nock.disableNetConnect();

const defaultConfig = extend(true, {}, DEFAULT_CONFIG, {logLevel: 0});

let oldGP;

const bp = {
  id: 'test',
  action: 'CAPTURE',
  location: {path: 'fixtures/foo.js', line: 2}
};
const errorBp = {
  id: 'testLog',
  action: 'FOO',
  location: {path: 'fixtures/foo.js', line: 2}
};

function verifyBreakpointRejection(re, body) {
  const status = body.breakpoint.status;
  const hasCorrectDescription = status.description.format.match(re);
  return status.isError && hasCorrectDescription;
}

describe('Debuglet', function() {
  describe('runningOnGCP', () => {
    let savedLookup;
    before(() => {
      savedLookup = dns.lookup;
    });
    
    after(() => {
      // TODO: Fix this cast to any that is caused by the fact that `lookup`
      //       is a readonly property.
      (dns as any).lookup = savedLookup;
    });

    it('should resolve true if metadata service is resolveable', (done) => {
      // TODO: Fix this cast to any that is caused by the fact that `lookup`
      //       is a readonly property.
      (dns as any).lookup = (hostname, cb) => {
        setImmediate(() => {
          cb(null, { address: '700.800.900.fake', family: 'Addams'});
        });
      };

      Debuglet.runningOnGCP().then((onGCP) => {
        assert.strictEqual(onGCP, true);
        done();
      });
    });

    it('should resolve false if metadata service not resolveable', (done) => {
      // TODO: Fix this cast to any that is caused by the fact that `lookup`
      //       is a readonly property.
      (dns as any).lookup = (hostname, cb) => {
        setImmediate(() => {
          cb(new Error('resolution error'));
        });
      };

      Debuglet.runningOnGCP().then((onGCP) => {
        assert.strictEqual(onGCP, false);
        done();
      });
    });
  });

  describe('getProjectIdFromMetadata', () => {
    let savedProject;
    before(() => {
      savedProject = metadata.project;
    });
    after(() => {
      metadata.project = savedProject;
    });

    it('should return project retrived from metadata', (done) => {
      const FAKE_PROJECT_ID = 'fake-project-id-from-metadata';
      // TODO: Determine if the options to Debug should be optional so that
      //       new Debug() can be used instead of new Debug({}).
      const debug = new Debug({});
      const debuglet = new Debuglet(debug, defaultConfig);

      metadata.project = (path, cb) => {
        setImmediate(() => { 
          cb(null, {}, FAKE_PROJECT_ID);
        });
      }

      Debuglet.getProjectIdFromMetadata().then((projectId) => {
        assert.strictEqual(projectId, FAKE_PROJECT_ID);
        done();
      });
    });

    it('should return null on error', (done) => {
      const debug = new Debug({});
      const debuglet = new Debuglet(debug, defaultConfig);

      metadata.project = (path, cb) => {
        setImmediate(() => { cb(new Error()); });
      }

      Debuglet.getProjectIdFromMetadata().catch((err) => {
        done();
      });
    });
  });

  describe('getClusterNameFromMetadata', () => {
    let savedInstance;
    before(() => {
      savedInstance = metadata.instance;
    });
    after(() => {
      metadata.instance = savedInstance;
    });

    it('should return project retrived from metadata', (done) => {
      const FAKE_CLUSTER_NAME = 'fake-cluster-name-from-metadata';
      const debug = new Debug({});
      const debuglet = new Debuglet(debug, defaultConfig);

      metadata.instance = (path, cb) => {
        setImmediate(() => { 
          cb(null, {}, FAKE_CLUSTER_NAME);
        });
      }

      Debuglet.getClusterNameFromMetadata().then((clusterName) => {
        assert.strictEqual(clusterName, FAKE_CLUSTER_NAME);
        done();
      });
    });

    it('should return null on error', (done) => {
      const debug = new Debug({});
      const debuglet = new Debuglet(debug, defaultConfig);

      metadata.instance = (path, cb) => {
        setImmediate(() => { cb(new Error()); });
      }

      Debuglet.getClusterNameFromMetadata().catch((err) => {
        done();
      });
    });
  });

  describe('getProjectId', () => {
    let savedGetProjectIdFromMetadata;

    beforeEach(() => {
      savedGetProjectIdFromMetadata = Debuglet.getProjectIdFromMetadata;
    });

    afterEach(() => {
      Debuglet.getProjectIdFromMetadata = savedGetProjectIdFromMetadata;
    });

    it('should not query metadata if local config.projectId is set', (done) => {
      Debuglet.getProjectIdFromMetadata = () => {
        // TODO: Fix this invalid method signature.
        (assert as any).fail();
        // TODO: Determine if this should be used here.
        return Promise.reject('');
      };
      Debuglet.getProjectId({ projectId: 'from-config' }).then((projectId) => {
        assert.strictEqual(projectId, 'from-config');
        done();
      });
    });

    it('should not query metadata if env. var. is set', (done) => {
      const envs = process.env;
      process.env = {};
      process.env.GCLOUD_PROJECT = 'from-env-var';

      Debuglet.getProjectIdFromMetadata = () => {
        // TODO: Fix this invalid method signature.
        (assert as any).fail();
        // TODO: Determine if this should be used here.
        return Promise.reject('');
      };
      Debuglet.getProjectId({}).then((projectId) => {
        assert.strictEqual(projectId, 'from-env-var');
        // restore environment variables.
        process.env = envs;
        done();
      });
    });

    it('should query the project from metadata', (done) => {
      const envs = process.env;
      process.env = {};

      Debuglet.getProjectIdFromMetadata = () => {
        return Promise.resolve('from-metadata');
      };
      Debuglet.getProjectId({}).then((projectId) => {
        assert.strictEqual(projectId, 'from-metadata');
        // restore environment variables.
        process.env = envs;
        done();        
      });
    });

    it('should reject on error', (done) => {
      const envs = process.env;
      process.env = {};

      Debuglet.getProjectIdFromMetadata = () => {
        return Promise.reject(new Error('rejection'));
      };
      Debuglet.getProjectId({}).catch((err) => {
        // restore environment variables.
        process.env = envs;
        done();
      });
    });   
  });

  describe('setup', function() {
    before(function() { oldGP = process.env.GCLOUD_PROJECT; });

    after(function() { process.env.GCLOUD_PROJECT = oldGP; });

    beforeEach(function() {
      delete process.env.GCLOUD_PROJECT;
      nocks.oauth2();
    });

    afterEach(function() { nock.cleanAll(); });

    it('should merge config correctly', function() {
      const testValue = 2 * defaultConfig.capture.maxExpandFrames;
      const config = {capture: {maxExpandFrames: testValue}};

      // TODO: Fix this so that config does not have to be cast as DebugAgentConfig.
      const mergedConfig = Debuglet.normalizeConfig_(config as DebugAgentConfig);
      // TODO: Debuglet.normalizeConfig_() expects 1 parameter.  Determine
      //       if `undefined` should be used here.
      const compareConfig = Debuglet.normalizeConfig_(undefined);
      // The actual config should be exactly defaultConfig with only
      // maxExpandFrames adjusted.
      compareConfig.capture.maxExpandFrames = testValue;
      assert.deepEqual(mergedConfig, compareConfig);
    });

    it('should not start when projectId is not available', function(done) {
      const savedGetProjectId = Debuglet.getProjectId;
      Debuglet.getProjectId = () => { 
        return Promise.reject(new Error('no project id'));
      };

      const debug = new Debug({});
      const debuglet = new Debuglet(debug, defaultConfig);

      debuglet.once('initError', function(err) {
        assert.ok(err);
        // no need to stop the debuggee.
        Debuglet.getProjectId = savedGetProjectId;
        done();
      });
      debuglet.once('started', function() {
        // TODO: Fix this invalid method signature.
        (assert as any).fail();
      });
      debuglet.start();
    });

    it('should not crash without project num', function(done) {
      const savedGetProjectId = Debuglet.getProjectId;
      Debuglet.getProjectId = () => { 
        return Promise.reject(new Error('no project id'));
      };

      const debug = new Debug({});
      const debuglet = new Debuglet(debug, defaultConfig);

      debuglet.once('started', function() {
        // TODO: Fix this invalid method signature.
        (assert as any).fail();
      });
      debuglet.once('initError', function() {
        Debuglet.getProjectId = savedGetProjectId;
        done();
      });
      debuglet.start();
    });

    it('should use config.projectId', function(done) {
      const projectId = '11020304f2934-a';
      const debug = new Debug(
          {projectId: projectId, credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      nocks.projectId('project-via-metadata');
      const scope = nock(API)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}});

      debuglet.once('registered', function(id) {
        assert.equal(id, DEBUGGEE_ID);
        assert.equal(debuglet.debuggee_.project, projectId);
        debuglet.stop();
        scope.done();
        done();
      });

      debuglet.start();
    });

    describe('environment variables', function() {
      let env;
      beforeEach(function() { env = extend({}, process.env); });
      afterEach(function() { process.env = extend({}, env); });

      it('should use GCLOUD_PROJECT in lieu of config.projectId', function(
                                                                      done) {
        process.env.GCLOUD_PROJECT = '11020304f2934-b';
        const debug = new Debug({credentials: fakeCredentials});
        const debuglet = new Debuglet(debug, defaultConfig);

        nocks.projectId('project-via-metadata');
        const scope = nock(API)
                        .post(REGISTER_PATH)
                        .reply(200, {debuggee: {id: DEBUGGEE_ID}});

        debuglet.once('registered', function(id) {
          assert.equal(id, DEBUGGEE_ID);
          assert.equal(debuglet.debuggee_.project, process.env.GCLOUD_PROJECT);
          debuglet.stop();
          scope.done();
          done();
        });

        debuglet.start();
      });

      it('should use options.projectId in preference to the environment variable',
         function(done) {
           process.env.GCLOUD_PROJECT = 'should-not-be-used';
           const debug = new Debug({
             projectId: 'project-via-options',
             credentials: fakeCredentials
           });
           const debuglet = new Debuglet(debug, defaultConfig);

           nocks.projectId('project-via-metadata');
           const scope = nock(API)
                           .post(REGISTER_PATH)
                           .reply(200, {debuggee: {id: DEBUGGEE_ID}});

           debuglet.once('registered', function(id) {
             assert.equal(id, DEBUGGEE_ID);
             assert.equal(debuglet.debuggee_.project, 'project-via-options');
             debuglet.stop();
             scope.done();
             done();
           });

           debuglet.start();
         });

      it('should respect GCLOUD_DEBUG_LOGLEVEL', function(done) {
        process.env.GCLOUD_PROJECT = '11020304f2934';
        process.env.GCLOUD_DEBUG_LOGLEVEL = 3;
        const debug = new Debug({credentials: fakeCredentials});
        const debuglet = new Debuglet(debug, defaultConfig);

        nocks.projectId('project-via-metadata');
        const scope = nock(API)
                        .post(REGISTER_PATH)
                        .reply(200, {debuggee: {id: DEBUGGEE_ID}});

        debuglet.once('registered', function() {
          const logger = debuglet.logger_;
          const STRING1 = 'jjjjjjjjjjjjjjjjjfjfjfjf';
          const STRING2 = 'kkkkkkkfkfkfkfkfkkffkkkk';

          let buffer = '';
          const oldLog = console.log;

          console.log = function(str) { buffer += str; };
          logger.info(STRING1);
          logger.debug(STRING2);
          console.log = oldLog;

          assert(buffer.indexOf(STRING1) !== -1);
          assert(buffer.indexOf(STRING2) === -1);

          debuglet.stop();
          scope.done();
          done();
        });

        debuglet.start();
      });

      it('should respect GAE_SERVICE and GAE_VERSION env. vars.', function() {
        process.env.GAE_SERVICE = 'fake-gae-service';
        process.env.GAE_VERSION = 'fake-gae-version';
        const debug = new Debug({});
        const debuglet = new Debuglet(debug, defaultConfig);
        assert.ok(debuglet.config_);
        assert.ok(debuglet.config_.serviceContext);
        assert.strictEqual(debuglet.config_.serviceContext.service,
                           'fake-gae-service');
        assert.strictEqual(debuglet.config_.serviceContext.version,
                           'fake-gae-version');
      });

      it('should respect GAE_MODULE_NAME and GAE_MODULE_VERSION env. vars.',
         function() {
           process.env.GAE_MODULE_NAME = 'fake-gae-service';
           process.env.GAE_MODULE_VERSION = 'fake-gae-version';
           const debug = new Debug({});
           const debuglet = new Debuglet(debug, defaultConfig);
           assert.ok(debuglet.config_);
           assert.ok(debuglet.config_.serviceContext);
           assert.strictEqual(debuglet.config_.serviceContext.service,
                              'fake-gae-service');
           assert.strictEqual(debuglet.config_.serviceContext.version,
                              'fake-gae-version');
         });

      it('should respect FUNCTION_NAME env. var.',
         function() {
           process.env.FUNCTION_NAME = 'fake-fn-name';
           const debug = new Debug({});
           const debuglet = new Debuglet(debug, defaultConfig);
           assert.ok(debuglet.config_);
           assert.ok(debuglet.config_.serviceContext);
           assert.strictEqual(debuglet.config_.serviceContext.service,
                              'fake-fn-name');
           assert.strictEqual(debuglet.config_.serviceContext.version,
                              'unversioned');
         });

      it('should prefer new flex vars over GAE_MODULE_*', function() {
        process.env.GAE_MODULE_NAME = 'fake-gae-module';
        process.env.GAE_MODULE_VERSION = 'fake-gae-module-version';
        process.env.GAE_SERVICE = 'fake-gae-service';
        process.env.GAE_VERSION = 'fake-gae-version';
        const debug = new Debug({});
        const debuglet = new Debuglet(debug, defaultConfig);
        assert.ok(debuglet.config_);
        assert.ok(debuglet.config_.serviceContext);
        assert.strictEqual(debuglet.config_.serviceContext.service,
                           'fake-gae-service');
        assert.strictEqual(debuglet.config_.serviceContext.version,
                           'fake-gae-version');
      });

      it('should respect GAE_MINOR_VERSION env. var. when available',
         function() {
           process.env.GAE_MINOR_VERSION = 'some minor version';
           const debug = new Debug({});
           const debuglet = new Debuglet(debug, defaultConfig);
           assert.ok(debuglet.config_);
           assert.ok(debuglet.config_.serviceContext);
           assert.strictEqual(debuglet.config_.serviceContext.minorVersion_,
                              'some minor version');
         });

      it('should conjure a fake minor version when running on flex',
         function() {
           process.env.GAE_SERVICE = 'fake-gae-service';
           const debug = new Debug({});
           const debuglet = new Debuglet(debug, defaultConfig);
           assert.ok(debuglet.config_);
           assert.ok(debuglet.config_.serviceContext);
           assert.ok(_.isString(debuglet.config_.serviceContext.minorVersion_));
         });

      it('should not have minorVersion unless enviroment provides it',
         function() {
           const debug = new Debug({});
           const debuglet = new Debuglet(debug, defaultConfig);
           assert.ok(debuglet.config_);
           assert.ok(debuglet.config_.serviceContext);
           assert.ok(
               // TODO: IMPORTANT: It appears that this test is incorrect as it
               //       is.  That is, if minorVersion is replaced with the
               //       correctly named minorVersion_, then the test fails.
               //       Resolve this.
               _.isUndefined((debuglet.config_.serviceContext as any).minorVersion));
         });

      it('should not provide minorversion upon registration on non flex',
         function(done) {
           const debug = new Debug(
               {projectId: 'fake-project', credentials: fakeCredentials});
           const debuglet = new Debuglet(debug, defaultConfig);

           const scope =
               nock(API).post(REGISTER_PATH, function(body) {
                          assert.ok(
                              _.isUndefined(body.debuggee.labels.minorversion));
                          return true;
                        }).once().reply(200, {debuggee: {id: DEBUGGEE_ID}});

           debuglet.once('registered', function(id) {
             debuglet.stop();
             scope.done();
             done();
           });
           debuglet.start();
         });

      it('should provide minorversion upon registration if on flex', function(
                                                                         done) {
        process.env.GAE_SERVICE = 'fake-service';
        const debug = new Debug(
            {projectId: 'fake-project', credentials: fakeCredentials});
        const debuglet = new Debuglet(debug, defaultConfig);

        nocks.oauth2();
        const scope =
            nock(API).post(REGISTER_PATH, function(body) {
                       assert.ok(_.isString(body.debuggee.labels.minorversion));
                       return true;
                     }).once().reply(200, {debuggee: {id: DEBUGGEE_ID}});

        debuglet.once('registered', function(id) {
          debuglet.stop();
          scope.done();
          done();
        });
        debuglet.start();
      });
    });

    it('should retry on failed registration', function(done) {
      this.timeout(10000);
      const debug = new Debug(
          {projectId: '11020304f2934', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      const scope = nock(API)
                      .post(REGISTER_PATH)
                      .reply(404)
                      .post(REGISTER_PATH)
                      .reply(509)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}});

      debuglet.once('registered', function(id) {
        assert.equal(id, DEBUGGEE_ID);
        debuglet.stop();
        scope.done();
        done();
      });

      debuglet.start();
    });

    it('should error if a package.json doesn\'t exist', function(done) {
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const config = extend({}, defaultConfig,
                          {workingDirectory: __dirname, forceNewAgent_: true});
      const debuglet = new Debuglet(debug, config);

      debuglet.once('initError', function(err) {
        assert(err);
        done();
      });

      debuglet.start();
    });

    it('should register successfully otherwise', function(done) {
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      nocks.oauth2();
      const scope = nock(API)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}});

      debuglet.once('registered', function(id) {
        assert.equal(id, DEBUGGEE_ID);
        debuglet.stop();
        scope.done();
        done();
      });

      debuglet.start();
    });

    it('should attempt to retrieve cluster name if needed', (done) => {
      const savedRunningOnGCP = Debuglet.runningOnGCP;
      Debuglet.runningOnGCP = () => {
        return Promise.resolve(true);
      };
      const clusterScope = 
          nock('http://metadata.google.internal')
            .get('/computeMetadata/v1/instance/attributes/cluster-name')
            .once()
            .reply(200, 'cluster-name-from-metadata');

      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      nocks.oauth2();
      const scope = nock(API)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}});

      debuglet.once('registered', function(id) {
        assert.equal(id, DEBUGGEE_ID);
        debuglet.stop();
        clusterScope.done();
        scope.done();
        Debuglet.runningOnGCP = savedRunningOnGCP;
        done();
      });

      debuglet.start();
    });

    it('should pass source context to api if present', function(done) {
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const old = Debuglet.prototype.getSourceContext_;
      Debuglet.prototype.getSourceContext_ = function(cb) {
        setImmediate(function () {
          // TODO: Determine if 5 should be converted to a string or if the
          //       the object literal should allow keys with values that are
          //       numbers.
          cb(null, {a: 5 as any as string});
        });
      };
      const debuglet = new Debuglet(debug, defaultConfig);

      const scope = nock(API).post(REGISTER_PATH, function(body) {
                             return body.debuggee.sourceContexts[0] &&
                                    body.debuggee.sourceContexts[0].a === 5;
                           }).reply(200, {debuggee: {id: DEBUGGEE_ID}});

      debuglet.once('registered', function(id) {
        Debuglet.prototype.getSourceContext_ = old;
        assert.equal(id, DEBUGGEE_ID);
        debuglet.stop();
        scope.done();
        done();
      });

      debuglet.start();
    });

    it('should de-activate when the server responds with isDisabled',
       function(done) {
         this.timeout(4000);
         const debug = new Debug(
             {projectId: 'fake-project', credentials: fakeCredentials});
         const debuglet = new Debuglet(debug, defaultConfig);

         const scope =
             nock(API)
                 .post(REGISTER_PATH)
                 .reply(200, {debuggee: {id: DEBUGGEE_ID, isDisabled: true}});

         debuglet.once('remotelyDisabled', function() {
           assert.ok(!debuglet.fetcherActive_);
           debuglet.stop();
           scope.done();
           done();
         });

         debuglet.start();
       });

    it('should retry after a isDisabled request', function(done) {
      this.timeout(4000);
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      const scope =
          nock(API)
              .post(REGISTER_PATH)
              .reply(200, {debuggee: {id: DEBUGGEE_ID, isDisabled: true}})
              .post(REGISTER_PATH)
              .reply(200, {debuggee: {id: DEBUGGEE_ID}});

      let gotDisabled = false;
      debuglet.once('remotelyDisabled', function() {
        assert.ok(!debuglet.fetcherActive_);
        gotDisabled = true;
      });

      debuglet.once('registered', function(id) {
        assert.ok(gotDisabled);
        assert.equal(id, DEBUGGEE_ID);
        debuglet.stop();
        scope.done();
        done();
      });

      debuglet.start();
    });

    it('should re-register when registration expires', function(done) {
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      const scope = nock(API)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}})
                      .get(BPS_PATH + '?successOnTimeout=true')
                      .reply(404)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}});

      debuglet.once('registered', function(id) {
        assert.equal(id, DEBUGGEE_ID);
        debuglet.once('registered', function(id) {
          assert.equal(id, DEBUGGEE_ID);
          debuglet.stop();
          scope.done();
          done();
        });
      });

      debuglet.start();
    });

    it('should fetch and add breakpoints', function(done) {
      this.timeout(2000);
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      const scope = nock(API)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}})
                      .get(BPS_PATH + '?successOnTimeout=true')
                      .reply(200, {breakpoints: [bp]});

      debuglet.once('registered', function reg(id) {
        assert.equal(id, DEBUGGEE_ID);
        setTimeout(function() {
          assert.deepEqual(debuglet.activeBreakpointMap_.test, bp);
          debuglet.stop();
          scope.done();
          done();
        }, 1000);
      });

      debuglet.start();
    });

    it('should reject breakpoints with conditions when allowExpressions=false',
        function(done) {
      this.timeout(2000);
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);
      debuglet.config_.allowExpressions = false;

      const scope = nock(API)
        .post(REGISTER_PATH)
        .reply(200, { debuggee: { id: DEBUGGEE_ID } })
        .get(BPS_PATH + '?successOnTimeout=true')
        .reply(200, {
          breakpoints: [{
            id: 'test',
            action: 'CAPTURE',
            condition: 'x === 5',
            location: { path: 'fixtures/foo.js', line: 2 }
          }]
        })
        .put(BPS_PATH + '/test',
             verifyBreakpointRejection.bind(null, EXPRESSIONS_REGEX))
        .reply(200);

      debuglet.once('registered', function reg(id) {
        assert.equal(id, DEBUGGEE_ID);
        setTimeout(function() {
          assert.ok(!debuglet.activeBreakpointMap_.test);
          debuglet.stop();
          debuglet.config_.allowExpressions = true;
          scope.done();
          done();
        }, 1000);
      });

      debuglet.start();
    });

    it('should reject breakpoints with expressions when allowExpressions=false',
        function(done) {
      this.timeout(2000);
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);
      debuglet.config_.allowExpressions = false;

      const scope = nock(API)
        .post(REGISTER_PATH)
        .reply(200, { debuggee: { id: DEBUGGEE_ID } })
        .get(BPS_PATH + '?successOnTimeout=true')
        .reply(200, {
          breakpoints: [{
            id: 'test',
            action: 'CAPTURE',
            expressions: ['x'],
            location: { path: 'fixtures/foo.js', line: 2 }
          }]
        })
        .put(BPS_PATH + '/test',
             verifyBreakpointRejection.bind(null, EXPRESSIONS_REGEX))
        .reply(200);

      debuglet.once('registered', function reg(id) {
        assert.equal(id, DEBUGGEE_ID);
        setTimeout(function() {
          assert.ok(!debuglet.activeBreakpointMap_.test);
          debuglet.stop();
          debuglet.config_.allowExpressions = true;
          scope.done();
          done();
        }, 1000);
      });

      debuglet.start();
    });

    it('should re-fetch breakpoints on error', function(done) {
      this.timeout(6000);

      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const debuglet = new Debuglet(debug, defaultConfig);

      const scope = nock(API)
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}})
                      .post(REGISTER_PATH)
                      .reply(200, {debuggee: {id: DEBUGGEE_ID}})
                      .get(BPS_PATH + '?successOnTimeout=true')
                      .reply(404)
                      .get(BPS_PATH + '?successOnTimeout=true')
                      .reply(200, {waitExpired: true})
                      .get(BPS_PATH + '?successOnTimeout=true')
                      .reply(200, {breakpoints: [bp, errorBp]})
                      .put(BPS_PATH + '/' + errorBp.id,
                           function(body) {
                             const status = body.breakpoint.status;
                             return status.isError &&
                                    status.description.format.indexOf(
                                        'actions are CAPTURE') !== -1;
                           })
                      .reply(200);

      debuglet.once('registered', function reg(id) {
        assert.equal(id, DEBUGGEE_ID);
        setTimeout(function() {
          assert.deepEqual(debuglet.activeBreakpointMap_.test, bp);
          assert(!debuglet.activeBreakpointMap_.testLog);
          debuglet.stop();
          scope.done();
          done();
        }, 1000);
      });

      debuglet.start();
    });

    it('should expire stale breakpoints', function(done) {
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const config = extend({}, defaultConfig,
                          {breakpointExpirationSec: 1, forceNewAgent_: true});
      this.timeout(6000);

      const scope =
          nock(API)
              .post(REGISTER_PATH)
              .reply(200, {debuggee: {id: DEBUGGEE_ID}})
              .get(BPS_PATH + '?successOnTimeout=true')
              .reply(200, {breakpoints: [bp]})
              .put(BPS_PATH + '/test',
                   function(body) {
                     const status = body.breakpoint.status;
                     return status.description.format === 'The snapshot has expired' &&
                            status.refersTo === 'BREAKPOINT_AGE';
                   })
              .reply(200);

      const debuglet = new Debuglet(debug, config);
      debuglet.once('registered', function(id) {
        assert.equal(id, DEBUGGEE_ID);
        setTimeout(function() {
          assert.deepEqual(debuglet.activeBreakpointMap_.test, bp);
          setTimeout(function() {
            assert(!debuglet.activeBreakpointMap_.test);
            debuglet.stop();
            scope.done();
            done();
          }, 1100);
        }, 500);
      });

      debuglet.start();
    });

    // This test catches regressions in a bug where the agent would
    // re-schedule an already expired breakpoint to expire if the
    // server listed the breakpoint as active (which it may do depending
    // on how quickly the expiry is processed).
    // The test expires a breakpoint and then has the api respond with
    // the breakpoint listed as active. It validates that the breakpoint
    // is only expired with the server once.
    it('should not update expired breakpoints', function(done) {
      const debug = new Debug(
          {projectId: 'fake-project', credentials: fakeCredentials});
      const config = extend({}, defaultConfig, {
        breakpointExpirationSec: 1,
        breakpointUpdateIntervalSec: 1,
        forceNewAgent_: true
      });
      this.timeout(6000);

      const scope =
          nock(API)
              .post(REGISTER_PATH)
              .reply(200, {debuggee: {id: DEBUGGEE_ID}})
              .get(BPS_PATH + '?successOnTimeout=true')
              .reply(200, {breakpoints: [bp]})
              .put(BPS_PATH + '/test',
                   function(body) {
                     return body.breakpoint.status.description.format ===
                            'The snapshot has expired';
                   })
              .reply(200)
              .get(BPS_PATH + '?successOnTimeout=true')
              .times(4)
              .reply(200, {breakpoints: [bp]});

      const debuglet = new Debuglet(debug, config);
      debuglet.once('registered', function(id) {
        assert.equal(id, DEBUGGEE_ID);
        setTimeout(function() {
          assert.deepEqual(debuglet.activeBreakpointMap_.test, bp);
          setTimeout(function() {
            assert(!debuglet.activeBreakpointMap_.test);
            // Fetcher disables if we re-update since endpoint isn't mocked
            // twice
            assert(debuglet.fetcherActive_);
            debuglet.stop();
            scope.done();
            done();
          }, 4500);
        }, 500);
      });

      debuglet.start();
    });
  });

  describe('map subtract', function() {
    it('should be correct', function() {
      const a = {a: 1, b: 2};
      const b = {a: 1};
      assert.deepEqual(Debuglet.mapSubtract(a, b), [2]);
      assert.deepEqual(Debuglet.mapSubtract(b, a), []);
      assert.deepEqual(Debuglet.mapSubtract(a, {}), [1, 2]);
      assert.deepEqual(Debuglet.mapSubtract({}, b), []);
    });
  });

  describe('format', function() {
    it('should be correct', function() {
      // TODO: Determine if Debuglet.format() should allow a number[]
      //       or if only string[] should be allowed.
      assert.deepEqual(Debuglet.format('hi', [5] as any as string[]), 'hi');
      assert.deepEqual(Debuglet.format('hi $0', [5] as any as string[]), 'hi 5');
      assert.deepEqual(Debuglet.format('hi $0 $1', [5, 'there'] as any as string[]), 'hi 5 there');
      assert.deepEqual(Debuglet.format('hi $0 $1', [5] as any as string[]), 'hi 5 $1');
      assert.deepEqual(Debuglet.format('hi $0 $1 $0', [5] as any as string[]), 'hi 5 $1 5');
      assert.deepEqual(Debuglet.format('hi $$', [5] as any as string[]), 'hi $');
      assert.deepEqual(Debuglet.format('hi $$0', [5] as any as string[]), 'hi $0');
      assert.deepEqual(Debuglet.format('hi $00', [5] as any as string[]), 'hi 50');
      assert.deepEqual(Debuglet.format('hi $0', ['$1', 5] as any as string[]), 'hi $1');
      assert.deepEqual(
          Debuglet.format('hi $11',
                          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 'a', 'b', 'c', 'd'] as any as string[]),
          'hi b');
    });
  });

  describe('createDebuggee', function() {
    it('should have sensible labels', function() {
      const debuggee = Debuglet.createDebuggee(
          'some project', 'id',
          // TODO: Verify that `null` for minorVersion_ should be used here
          //       or if minorVersion_ should be optional.
          {service: 'some-service', version: 'production', minorVersion_: null},
          // TODO: Determine if these are the correct values that should be
          //       use here.
          {}, null, null, false);
      assert.ok(debuggee);
      assert.ok(debuggee.labels);
      assert.strictEqual(debuggee.labels.module, 'some-service');
      assert.strictEqual(debuggee.labels.version, 'production');
    });

    it('should not add a module label when service is default', function() {
      const debuggee =
          Debuglet.createDebuggee('fancy-project', 'very-unique',
                                  // TODO: Verify that `null` for minorVersion_ should be used here
                                  //       or if minorVersion_ should be optional.
                                  {service: 'default', version: 'yellow.5', minorVersion_: null},
                                  // TODO: Determine if these are the correct values that should be
                                  //       use here.
                                  {}, null, null, false);
      assert.ok(debuggee);
      assert.ok(debuggee.labels);
      assert.strictEqual(debuggee.labels.module, undefined);
      assert.strictEqual(debuggee.labels.version, 'yellow.5');
    });

    it('should have an error statusMessage with the appropriate arg',
       function() {
         const debuggee = Debuglet.createDebuggee(
             'a', 'b', undefined, undefined, undefined, 'Some Error Message',
             // TODO: Determine if this value for onGCP is correct.
             false);
         assert.ok(debuggee);
         assert.ok(debuggee.statusMessage);
       });
  });

  describe('_createUniquifier', function () {
    it('should create a unique string', function () {
      const fn = Debuglet._createUniquifier;

      const desc = 'description';
      const version = 'version';
      const uid = 'uid';
      const sourceContext = {
        git: 'something'
      };
      const labels = {
        key: 'value'
      };

      const u1 = fn(desc, version, uid, sourceContext, labels);

      assert.strictEqual(fn(desc, version, uid, sourceContext, labels), u1);

      assert.notStrictEqual(
        fn('foo', version, uid, sourceContext, labels),
        u1,
        'changing the description should change the result');
      assert.notStrictEqual(
        fn(desc, '1.2', uid, sourceContext, labels),
        u1,
        'changing the version should change the result');
      assert.notStrictEqual(
        fn(desc, version, '5', sourceContext, labels), u1,
        'changing the description should change the result');
      assert.notStrictEqual(
        fn(desc, version, uid, { git: 'blah' }, labels),
        u1,
        'changing the sourceContext should change the result');
      assert.notStrictEqual(
        fn(desc, version, uid, sourceContext, { key1: 'value2' }),
        u1,
        'changing the labels should change the result');
    });
  });
});