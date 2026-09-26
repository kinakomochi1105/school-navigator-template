import "./style.css";
import { initMap } from "./map/index.js";
import { bindRoomSearch, selectRoom } from "./map/search.js";

initMap({ onRoomClick: selectRoom });
bindRoomSearch();
