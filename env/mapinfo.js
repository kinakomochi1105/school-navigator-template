/// <reference path="../types/map.d.ts"/>

/** @type {MapInfo} */
const map = {
  floors: [
    {
      floorFile: "map/floor1.svg",
      floorName: "Floor 1",
      rooms: [
        {
          name: "Entrance",
          lineDot: [700, 100],
          bounds: [[650, 70], [750, 150]],
        },
        {
          name: "Room A",
          searchTerms: ["room-a", "a"],
          lineDot: [250, 250],
          bounds: [[180, 100], [320, 300]],
        },
        {
          name: "Room B",
          searchTerms: ["room-b", "b"],
          lineDot: [250, 550],
          bounds: [[380, 100], [520, 300]],
        },
      ],
    },
  ],
};

export default map;