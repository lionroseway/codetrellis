/**
 * Unit tests for peer authorisation (Phase 19, findings 17 and 15).
 *
 * The coverage test is the important one. A capability matrix that drifts
 * from the router is worse than none: methods silently fall through to
 * "unlisted", and whoever added them never finds out until a peer is refused
 * in the field. So the matrix is checked against the router's own source.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  assertPeerMayCall,
  METHOD_CAPABILITIES,
  DEFAULT_GRANTS,
  PeerAuthorizationError,
  listAuthorisedMethods,
} from './peer-capabilities';

describe('the matrix covers the router — and cannot drift from it', () => {
  test('every method the router handles has an explicit capability', () => {
    const routerSrc = fs.readFileSync(
      path.join(__dirname, 'mobile-rpc-service.ts'),
      'utf-8',
    );

    // The router dispatches on `case 'method.name':`. Reading its source is
    // blunt, but it is the only way to catch a method added to the switch
    // without a matrix entry — which is exactly the drift worth catching.
    const routed = new Set(
      [...routerSrc.matchAll(/case '([a-zA-Z0-9_.]+)':/g)].map((m) => m[1]),
    );

    assert.ok(routed.size > 40, `sanity: expected to find many methods, found ${routed.size}`);

    const missing = [...routed].filter((m) => !(m in METHOD_CAPABILITIES));
    assert.deepEqual(
      missing,
      [],
      `these RPC methods have no capability assigned:\n  ${missing.join('\n  ')}\n` +
        'Add them to METHOD_CAPABILITIES. Unlisted methods are refused at runtime, ' +
        'so leaving one out breaks it for peers rather than exposing it — but it ' +
        'should be a deliberate classification, not an omission.',
    );
  });

  test('the matrix contains no methods the router does not handle', () => {
    const routerSrc = fs.readFileSync(
      path.join(__dirname, 'mobile-rpc-service.ts'),
      'utf-8',
    );
    const routed = new Set(
      [...routerSrc.matchAll(/case '([a-zA-Z0-9_.]+)':/g)].map((m) => m[1]),
    );
    const stale = listAuthorisedMethods().filter((m) => !routed.has(m));
    assert.deepEqual(stale, [], `the matrix lists methods the router no longer handles: ${stale.join(', ')}`);
  });
});

describe('deny by default', () => {
  test('an unlisted method is refused even with every capability', () => {
    assert.throws(
      () =>
        assertPeerMayCall('some.new.method', ['read', 'write', 'project', 'files', 'settings', 'terminal'], {
          confirmed: true,
        }),
      PeerAuthorizationError,
      'a method nobody classified must fail CLOSED',
    );
  });

  test('a method is refused when the capability is not held', () => {
    assert.throws(
      () => assertPeerMayCall('plan.create', ['read'], { confirmed: true }),
      PeerAuthorizationError,
    );
  });

  test('no grants at all refuses everything', () => {
    assert.throws(() => assertPeerMayCall('plan.list', [], { confirmed: true }), PeerAuthorizationError);
    assert.throws(() => assertPeerMayCall('plan.list', undefined, { confirmed: true }), PeerAuthorizationError);
  });
});

describe('the default grant', () => {
  test('lets a newly-paired phone do the ordinary things', () => {
    for (const method of ['plan.list', 'graph.overview', 'plan.create', 'project.open', 'fs.browse']) {
      assert.doesNotThrow(
        () => assertPeerMayCall(method, DEFAULT_GRANTS, { confirmed: true }),
        `${method} should work for a normally-paired device`,
      );
    }
  });

  test('does NOT include terminal — pairing a phone must not hand it a shell', () => {
    for (const method of ['terminal.create', 'terminal.write', 'terminal.list']) {
      assert.throws(
        () => assertPeerMayCall(method, DEFAULT_GRANTS, { confirmed: true }),
        PeerAuthorizationError,
        `${method} must not be in the default grant`,
      );
    }
  });

  test('does NOT include settings — a device must not widen its own reach', () => {
    // settings.update can flip device.exposeMobileApi, which is the switch
    // that puts the mobile API on every network interface.
    assert.throws(
      () => assertPeerMayCall('settings.update', DEFAULT_GRANTS, { confirmed: true }),
      PeerAuthorizationError,
    );
    // Reading settings is fine.
    assert.doesNotThrow(() => assertPeerMayCall('settings.get', DEFAULT_GRANTS, { confirmed: true }));
  });
});

describe('command execution requires a confirmed pairing', () => {
  test('terminal methods are refused on an unconfirmed connection even WITH the grant', () => {
    for (const method of ['terminal.create', 'terminal.write']) {
      assert.throws(
        () => assertPeerMayCall(method, ['terminal'], { confirmed: false }),
        PeerAuthorizationError,
        `${method} must require a confirmed pairing`,
      );
    }
  });

  test('and permitted once confirmed and granted', () => {
    assert.doesNotThrow(() => assertPeerMayCall('terminal.create', ['terminal'], { confirmed: true }));
  });

  test('a non-terminal method does not require confirmation', () => {
    // Confirmation gates COMMAND EXECUTION specifically. Requiring it for
    // everything would break the pairing flow itself.
    assert.doesNotThrow(() => assertPeerMayCall('plan.list', ['read'], { confirmed: false }));
  });
});

describe('capability classification sanity', () => {
  test('every terminal.* method is classified as terminal', () => {
    for (const [method, cap] of Object.entries(METHOD_CAPABILITIES)) {
      if (method.startsWith('terminal.')) {
        assert.equal(cap, 'terminal', `${method} must be a terminal capability`);
      }
    }
  });

  test('nothing that returns file content is merely "read"', () => {
    // graph.fileSource and fs.browse return file CONTENT and directory
    // listings, which is a different question from plan metadata.
    assert.equal(METHOD_CAPABILITIES['graph.fileSource'], 'files');
    assert.equal(METHOD_CAPABILITIES['fs.browse'], 'files');
  });
});
