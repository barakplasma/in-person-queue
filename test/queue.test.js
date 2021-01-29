describe('Chisonnumber', () => {
  describe('Queue', () => {
    let queue = require('../queue/queue');
    let testQueueId = '8F2C4M6J+9V'

    beforeAll(() => {
      console.log = jest.fn();
      jest.spyOn(queue._redis, 'zadd');
    })
    afterAll(() => {
      queue._redis.quit();
    })

    beforeEach(() => {
      queue._redis.del(testQueueId);
      console.log.mockClear();
      queue._redis.zadd.mockClear();
    })
    describe('Create Queue', () => {
      it('should be able to create a queue', () => {
        return queue.createQueue(testQueueId).then((res) => {
          expect(res).toBe(undefined)
          expect(console.log).toHaveBeenLastCalledWith({ EventName: 'created queue', queue: testQueueId })
          expect(queue._redis.zadd).toHaveBeenLastCalledWith(testQueueId, [1, "Start Queue"])
        })
      })
    })

    describe('Get Position', () => {
      it('should find created queue', async () => {
        await queue.createQueue(testQueueId);
        return queue.getPosition(testQueueId, 'Start Queue').then(res => {
          expect(res).toBe(0);
        })
      })
      it('should find 3rd person in queue', async () => {
        await queue.createQueue(testQueueId);
        await queue.addUserToQueue(testQueueId, 'b');
        await queue.addUserToQueue(testQueueId, 'c');
        await queue.addUserToQueue(testQueueId, 'd');
        await queue.addUserToQueue(testQueueId, 'e');
        return queue.getPosition(testQueueId, 'd').then(res => {
          expect(res).toBe(3);
        })
      })
    })

    describe('Get Head of Queue', () => {
      it('should find head of new queue', async () => {
        await queue.createQueue(testQueueId);
        return queue.getHeadOfQueue(testQueueId).then(res => {
          expect(res).toBe("Start Queue");
        })
      })
      it('should find head of old queue', async () => {
        await queue.createQueue(testQueueId);
        await queue.addUserToQueue(testQueueId, 'b');
        await queue.addUserToQueue(testQueueId, 'c');
        await queue.addUserToQueue(testQueueId, 'd');
        await queue.addUserToQueue(testQueueId, 'e');
        await queue.removeUserFromQueue(testQueueId, "Start Queue");
        await queue.removeUserFromQueue(testQueueId, "c");
        await queue.removeUserFromQueue(testQueueId, "b");
        return queue.getHeadOfQueue(testQueueId).then(res => {
          expect(res).toBe("d");
        })
      })
    })

    describe('Current User Done', () => {
      it('should mark first user in queue done and next user as current head of queue', async () => {
        await queue.createQueue(testQueueId);
        await queue.addUserToQueue(testQueueId, 'b');
        await queue.addUserToQueue(testQueueId, 'c');
        await queue.addUserToQueue(testQueueId, 'd');
        expect(await queue.getHeadOfQueue(testQueueId)).toBe("Start Queue");
        expect(await queue.shiftQueue(testQueueId)).toStrictEqual(["Start Queue", "1"]);
        return queue.getHeadOfQueue(testQueueId).then(res => {
          expect(res).toBe("b");
        })
      })
    })

    describe('Add user to queue', () => {
      it('should add users and get the right count', async () => {
        await queue.createQueue(testQueueId);
        await queue.addUserToQueue(testQueueId, 'b')
        return queue.addUserToQueue(testQueueId, 'c').then(() => {
          return queue.getQueueLength(testQueueId);
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(3);
          expect(console.log).toHaveBeenLastCalledWith({ EventName: 'added to queue', "queue": "8F2C4M6J+9V", "userId": "c", "endOfQueueScore": 3 })
        })
      })

      it('should try to add existing user and have same count', async () => {
        await queue.createQueue(testQueueId);
        await queue.addUserToQueue(testQueueId, 'b')
        await queue.addUserToQueue(testQueueId, 'c') // add a second time
        return queue.addUserToQueue(testQueueId, 'c').then(() => {
          return queue.getQueueLength(testQueueId);
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(3);
          expect(console.log).toHaveBeenLastCalledWith({ EventName: 'user already in queue', "queue": "8F2C4M6J+9V", "userId": "c" })
        })
      })
    })

    describe('Get queue length', () => {
      it('should add users and get the right count', async () => {
        await queue.createQueue(testQueueId);
        return queue.getQueueLength(testQueueId).then((countUsers) => {
          expect(countUsers).toBe(1);
        })
      })
    })

    describe('Remove user from queue', () => {
      it('should remove a user and get the right count', async () => {
        await queue.createQueue(testQueueId);
        await queue.addUserToQueue(testQueueId, 'b')
        return queue.removeUserFromQueue(testQueueId, 'c').then(() => {
          return queue.getQueueLength(testQueueId);
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(2);
        })
      })

      it('should try to remove non-existing user and have same count', async () => {
        await queue.createQueue(testQueueId);
        await queue.addUserToQueue(testQueueId, 'b')
        await queue.addUserToQueue(testQueueId, 'c')
        return queue.removeUserFromQueue(testQueueId, 'd').then(() => {
          return queue.getQueueLength(testQueueId);
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(3);
        })
      })

      it('should try to remove from empty queue', async () => {
        await queue.createQueue(testQueueId);
        await queue.removeUserFromQueue(testQueueId, 'Start Queue')
        return queue.removeUserFromQueue(testQueueId, 'd').then(() => {
          return queue.getQueueLength(testQueueId);
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(0);
        })
      })
    })
  })
})
