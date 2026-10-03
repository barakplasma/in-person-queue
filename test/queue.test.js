const {describe, it, beforeEach, after} = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../queue/queue');

const testLocation = '32.0800,34.7800';
const testQueueId = 'q:' + testLocation;
const password = 'test-password';
const redis = queue._redis;

describe('Queue', () => {
  beforeEach(() => redis.del(testQueueId, 'qm:' + testQueueId, 'queues'));
  after(async () => {
    await redis.del(testQueueId, 'qm:' + testQueueId, 'queues');
    await redis.quit();
  });

  const create = () => queue.createQueue(testQueueId, password);
  const addUsers = async (...ids) => {
    for (const id of ids) await queue.addUserToQueue(testQueueId, id);
  };

  describe('createQueue', () => {
    it('creates a queue with a start marker, password and expiry', async () => {
      assert.equal(await create(), true);
      assert.equal(await queue.getHeadOfQueue(testQueueId), 'Start Queue');
      assert.equal(await redis.hget('qm:' + testQueueId, 'password'), password);
      assert.ok((await redis.ttl(testQueueId)) > 0);
    });

    it('refuses to overwrite an existing queue (would hijack its admin)', async () => {
      await create();
      assert.equal(await queue.createQueue(testQueueId, 'attacker'), false);
      assert.equal(await queue.checkAuthForQueue({queue: testQueueId, password}), true);
    });

    it('creates the metadata and the queue together', async () => {
      await create();
      assert.ok((await redis.ttl('qm:' + testQueueId)) > 0);
      assert.equal(await redis.zcard('queues'), 1);
    });

    it('rejects invalid locations and missing passwords', async () => {
      await assert.rejects(queue.createQueue('q:<script>', password));
      await assert.rejects(queue.createQueue(testQueueId, ''));
    });
  });

  describe('getClosestQueues', () => {
    it('finds a queue ~100m away', async () => {
      await create();
      const [nearest, ...rest] = await queue.getClosestQueues('32.0809,34.7800');
      assert.equal(nearest.queue, testLocation);
      assert.ok(Math.abs(Number(nearest.distance) - 100) < 2, nearest.distance);
      assert.deepEqual(rest, []);
    });

    it('drops expired queues from the geo index', async () => {
      await create();
      await redis.del('qm:' + testQueueId);
      assert.deepEqual(await queue.getClosestQueues(testLocation), []);
      assert.equal(await redis.zcard('queues'), 0);
    });

    it('rejects invalid locations', async () => {
      await assert.rejects(queue.getClosestQueues('nope'));
    });
  });

  describe('parseLocation', () => {
    it('rounds to ~11m and canonicalizes', () => {
      assert.deepEqual(queue.parseLocation(' 32.08004 , 34.78 '), {
        lat: 32.08,
        lon: 34.78,
        location: '32.0800,34.7800',
      });
      assert.equal(queue.parseLocation('-0.00001,-0.00001').location, '0.0000,0.0000');
      assert.equal(queue.parseLocation('-33.9,151').location, '-33.9000,151.0000');
    });

    it('rejects garbage and out-of-range coordinates', () => {
      for (const bad of ['', ',', '1', '1,2,3', 'a,b', '90,0', '0,181', '1e3,0', '<b>,1', null]) {
        assert.throws(() => queue.parseLocation(bad), /invalid location/, String(bad));
      }
    });
  });

  describe('checkAuthForQueue', () => {
    it('rejects wrong or missing passwords', async () => {
      await create();
      assert.equal(await queue.checkAuthForQueue({queue: testQueueId, password: 'wrong'}), false);
      assert.equal(await queue.checkAuthForQueue({queue: testQueueId}), false);
      assert.equal(await queue.checkAuthForQueue({queue: 'q:none', password: undefined}), false);
    });

    it('accepts the right password', async () => {
      await create();
      assert.equal(await queue.checkAuthForQueue({queue: testQueueId, password}), true);
    });
  });

  describe('positions', () => {
    it('finds the 4th person', async () => {
      await create();
      await addUsers('b', 'c', 'd', 'e');
      assert.equal(await queue.getPosition(testQueueId, 'd'), 3);
      assert.equal(await queue.getQueueLength(testQueueId), 5);
    });

    it('does not add a user twice', async () => {
      await create();
      await addUsers('b', 'c');
      assert.equal(
        (await queue.addUserToQueue(testQueueId, 'c')).EventName,
        'user already in queue',
      );
      assert.equal(await queue.getQueueLength(testQueueId), 3);
    });

    it('refuses to add users to a queue that does not exist', async () => {
      await assert.rejects(queue.addUserToQueue(testQueueId, 'b'));
      assert.equal(await queue.getQueueLength(testQueueId), 0);
    });

    it('keeps users added to a legacy queue without a TTL', async () => {
      await redis.hset('qm:' + testQueueId, 'password', password);
      await redis.zadd(testQueueId, 1, 'Start Queue');
      await addUsers('b');
      assert.equal(await queue.getPosition(testQueueId, 'b'), 1);
    });

    it('still accepts users after the queue was emptied', async () => {
      await create();
      await queue.shiftQueue(testQueueId);
      await addUsers('b');
      assert.equal(await queue.getHeadOfQueue(testQueueId), 'b');
      assert.ok((await redis.ttl(testQueueId)) > 0);
    });
  });

  describe('head of queue', () => {
    it('advances when the current user is done', async () => {
      await create();
      await addUsers('b', 'c', 'd');
      assert.deepEqual(await queue.shiftQueue(testQueueId), ['Start Queue', '1']);
      assert.equal(await queue.getHeadOfQueue(testQueueId), 'b');
    });

    it('skips removed users', async () => {
      await create();
      await addUsers('b', 'c', 'd', 'e');
      for (const id of ['Start Queue', 'c', 'b']) await queue.removeUserFromQueue(testQueueId, id);
      assert.equal(await queue.getHeadOfQueue(testQueueId), 'd');
    });

    it('removing a missing user is a no-op', async () => {
      await create();
      await queue.removeUserFromQueue(testQueueId, 'nobody');
      assert.equal(await queue.getQueueLength(testQueueId), 1);
    });
  });

  describe('admin message', () => {
    it('stores a truncated admin message', async () => {
      await create();
      await queue.updateAdminMessage(testQueueId, 'x'.repeat(2000));
      assert.equal((await queue.getQueueMetadata(testQueueId)).adminMessage.length, 1000);
    });
  });
});
