import "./style.css";
import { initMap } from "./map/index";
import { bindRoomSearch, selectRoom } from "./map/search";

initMap({ onRoomClick: selectRoom });
bindRoomSearch();
