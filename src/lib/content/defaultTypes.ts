// Given sets offered for a student's own topic, with example values for the Example
// panel. Values are display atoms only (not Z syntax). DATE values are written as
// day.Month (e.g. 2.Feb), as on the lecture slides.

export const DEFAULT_GIVEN_SETS: { name: string; values: string[]; comment: string }[] = [
  {
    name: 'NAME',
    values: ['Ada', 'Ben', 'Cleo', 'Dev', 'Eva', 'Finn', 'Gus', 'Hana'],
    comment: 'Names.',
  },
  {
    name: 'PERSON',
    values: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi'],
    comment: 'People, e.g. customers, users or staff.',
  },
  {
    name: 'DATE',
    values: ['2.Feb', '17.Apr', '8.Jun', '23.Jul', '5.Sep', '11.Nov', '29.Jan', '14.Mar'],
    comment: 'Days of the year.',
  },
  {
    name: 'TIME',
    values: ['08:00', '09:30', '11:15', '12:00', '13:45', '15:30', '17:00', '20:15'],
    comment: 'Times of day.',
  },
  {
    name: 'ROOM',
    values: ['A101', 'A102', 'B201', 'B202', 'C301', 'C302', 'D401', 'D402'],
    comment: 'Rooms or other places.',
  },
  {
    name: 'ITEM',
    values: ['book', 'laptop', 'phone', 'key', 'bike', 'ticket', 'badge', 'camera'],
    comment: 'Things that can be lent, sold or stored.',
  },
];
