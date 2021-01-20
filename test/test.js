describe('Chisonnumber', () => {
  describe('Queue', () => {
    let queue = require('../queue/queue');
    beforeAll(()=>{
      console.log = jest.fn();
    })
    afterAll(() => {
      queue._redis.quit();
    })

    beforeEach(()=>{
      queue._redis.del('a');
      console.log.mockClear();
    })
    describe('Create Queue', () => {
      it('should be able to create a queue', () => {
        return queue.createQueue('a').then((res) => {
          expect(res).toBe(undefined)
          expect(console.log).toHaveBeenLastCalledWith({ EventName: 'created queue', queue: 'a' })
        })
      })
    })

    describe('Get Position', () => {
      it('should find created queue', async () => {
        await queue.createQueue('a');
        return queue.getPosition('a', 'Start Queue').then(res => {
          expect(res).toBe(0);
        })
      })
      it('should find 3rd person in queue', async () => {
        await queue.createQueue('a');
        await queue.addUserToQueue('a', 'b');
        await queue.addUserToQueue('a', 'c');
        await queue.addUserToQueue('a', 'd');
        await queue.addUserToQueue('a', 'e');
        return queue.getPosition('a', 'd').then(res => {
          expect(res).toBe(3);
        })
      })
    })
    
    describe('Add user to queue', () => {
      it('should add users and get the right count', async () => {
        await queue.createQueue('a');
        await queue.addUserToQueue('a', 'b')
        return queue.addUserToQueue('a', 'c').then(() => {
          return queue._redis.zcard('a');
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(3);
          expect(console.log).toHaveBeenLastCalledWith({ EventName: 'added to queue', "queue": "a", "userId": "c"})
        })
      })

      it('should try to add existing user and have same count', async () => {
        await queue.createQueue('a');
        await queue.addUserToQueue('a', 'b')
        await queue.addUserToQueue('a', 'c') // add a second time
        return queue.addUserToQueue('a', 'c').then(() => {
          return queue._redis.zcard('a');
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(3);
          expect(console.log).toHaveBeenLastCalledWith({ EventName: 'user already in queue', "queue": "a", "userId": "c"})
        })
      })
    })

    describe('Remove user from queue', () => {
      it('should remove a user and get the right count', async () => {
        await queue.createQueue('a');
        await queue.addUserToQueue('a', 'b')
        return queue.removeUserFromQueue('a', 'c').then(() => {
          return queue._redis.zcard('a');
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(2);
        })
      })

      it('should try to remove non-existing user and have same count', async () => {
        await queue.createQueue('a');
        await queue.addUserToQueue('a', 'b')
        await queue.addUserToQueue('a', 'c')
        return queue.removeUserFromQueue('a', 'd').then(() => {
          return queue._redis.zcard('a');
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(3);
        })
      })

      it('should try to remove from empty queue', async () => {
        await queue.createQueue('a');
        await queue.removeUserFromQueue('a', 'Start Queue')
        return queue.removeUserFromQueue('a', 'd').then(() => {
          return queue._redis.zcard('a');
        }).then(countUsers => {
          // first user is "Start Queue"
          expect(countUsers).toBe(0);
        })
      })
    })
  })
})
