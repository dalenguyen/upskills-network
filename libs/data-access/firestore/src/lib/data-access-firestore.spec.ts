import { dataAccessFirestore } from './data-access-firestore';

describe('dataAccessFirestore', () => {
  it('should work', () => {
    expect(dataAccessFirestore()).toEqual('data-access-firestore');
  });
});
