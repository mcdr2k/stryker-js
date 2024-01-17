
import { confuse, add, subtract } from '../src/functions';
import { expect } from 'chai';

// reaches: [0, 1]
describe(add.name, () => {
  it('should sum a and b', () => {
    expect(add(0, 0)).eq(0);
  })
});

// reaches: [2, 3]
describe(subtract.name, () => {
  it('should subtract a and b', () => {
    expect(subtract(1, 2)).eq(-1);
  });
});

// reaches: [1, 2, 3, 4, 5, 6]
describe(confuse.name, () => {
  // it('adds when confused', () => {
  //   expect(confuse(1, 3, true)).eq(4);
  // }),
  it('subtracts when not confused', () => {
    expect(confuse(1, 3, false)).eq(-2);
  })
});

// reaches: [0, 1, 2, 3, 5]
describe('hidden dependency', () => {
  const initial = 6;
  let dependency;
  beforeEach(() =>{
    dependency = subtract(initial, 3);
  });

  it('should have subtracted 3, cancelling out the 3 we add now', () => {
    expect(add(dependency, 3)).eq(6);
  });  
});
