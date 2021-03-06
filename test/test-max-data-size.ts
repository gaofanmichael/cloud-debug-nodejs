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

process.env.GCLOUD_DIAGNOSTICS_CONFIG = 'test/fixtures/test-config.js';

import {Common, LoggerOptions} from '../src/types/common';
import * as stackdriver from '../src/types/stackdriver';

import * as assert from 'assert';
import * as extend from 'extend';
const common: Common = require('@google-cloud/common');
import * as debugapi from '../src/agent/v8/debugapi';
import * as SourceMapper from '../src/agent/io/sourcemapper';
import * as scanner from '../src/agent/io/scanner';
import defaultConfig from '../src/agent/config';
const foo = require('./test-max-data-size-code.js');
let api: debugapi.DebugApi;

// TODO: Have this actually implement Breakpoint
const breakpointInFoo: stackdriver.Breakpoint = {
  id: 'fake-id-123',
  location: {path: 'build/test/test-max-data-size-code.js', line: 4}
} as stackdriver.Breakpoint;

describe('maxDataSize', function() {
  const config = extend({}, defaultConfig, {forceNewAgent_: true});

  before(function(done) {
    if (!api) {
      // TODO: It appears `logLevel` is a typo and should be `level`.  However,
      //       with this change, the tests fail.  Resolve this.
      const logger = new common.logger(
          {levelLevel: config.logLevel} as any as LoggerOptions);
      scanner.scan(true, config.workingDirectory, /.js$/)
          .then(function(fileStats) {
            const jsStats = fileStats.selectStats(/.js$/);
            const mapFiles = fileStats.selectFiles(/.map$/, process.cwd());
            SourceMapper.create(mapFiles, function(err, mapper) {
              assert(!err);

              // TODO: Handle the case when mapper is undefined
              // TODO: Handle the case when v8debugapi.create returns null
              api =
                  debugapi.create(
                      logger, config, jsStats,
                      mapper as SourceMapper.SourceMapper) as debugapi.DebugApi;
              done();
            });
          });
    } else {
      done();
    }
  });

  it('should limit data reported', function(done) {
    const oldMaxData = config.capture.maxDataSize;
    config.capture.maxDataSize = 5;
    // clone a clean breakpointInFoo
    // TODO: Have this actually implement Breakpoint.
    const bp: stackdriver.Breakpoint = {
      id: breakpointInFoo.id,
      location: breakpointInFoo.location
    } as stackdriver.Breakpoint;
    // TODO: Determine how to remove this cast to any.
    api.set(bp, function(err1) {
      assert.ifError(err1);
      // TODO: Determine how to remove this cast to any.
      api.wait(bp, function(err2?: Error) {
        assert.ifError(err2);
        // TODO: Determine how to remove this cast to any.
        assert(bp.variableTable.some(function(v) {
          // TODO: Handle the case when v is undefined
          // TODO: Handle the case when v.status is undefined
          return ((v as any).status as any).description.format ===
              'Max data size reached';
        }));
        // TODO: Determine how to remove this cast to any.
        api.clear(bp, function(err3) {
          config.capture.maxDataSize = oldMaxData;
          assert.ifError(err3);
          done();
        });
      });
      process.nextTick(function() {
        foo(2);
      });
    });
  });

  it('should be unlimited if 0', function(done) {
    const oldMaxData = config.capture.maxDataSize;
    config.capture.maxDataSize = 0;
    // clone a clean breakpointInFoo
    // TODO: Have this actually implement breakpoint
    const bp: stackdriver.Breakpoint = {
      id: breakpointInFoo.id,
      location: breakpointInFoo.location
    } as stackdriver.Breakpoint;
    api.set(bp, function(err1) {
      assert.ifError(err1);
      api.wait(bp, function(err2?: Error) {
        assert.ifError(err2);
        // TODO: Determine how to remove this cast to any.
        // TODO: The function supplied to reduce is of the wrong type.
        //       Fix this.
        assert(
            bp.variableTable.reduce(
                function(acc: Function, elem: stackdriver.Variable) {
                  return acc &&
                      (!elem.status ||
                       elem.status.description.format !==
                           'Max data size reached');
                  // TODO: Fix this incorrect method signature.
                } as any),
            true as any as string);
        api.clear(bp, function(err3) {
          config.capture.maxDataSize = oldMaxData;
          assert.ifError(err3);
          done();
        });
      });
      process.nextTick(function() {
        foo(2);
      });
    });
  });
});
