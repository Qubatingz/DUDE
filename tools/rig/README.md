# Dude's bones (the rig)

Painted Dude on a skeleton of 20 bones, so the app can pose him live (look at you, talk, wave, point, dance)
instead of only playing video clips.

1. `art/dude-apose.jpg`: one picture of Dude in an A-pose on a blue background (made with an image AI).
2. `python3 key.py ../../art/dude-apose.jpg cut.png` cuts him out of the blue.
3. `python3 edges.py ../../art/dude-apose.jpg cut.png cut2.png 65,155,203` cleans his outline (no blue rim).
4. `python3 build_rig.py cut2.png out/` makes `rig.png` (his painting), `rig-groups.png` (which part each pixel
   belongs to: legs, body, head, arms) and `rig.json` (bones, meshes and how much each bone moves each point).
   His t-shirt sleeves are weighted between his body and his arm, so they stretch like cloth.
5. `web/rig.js` draws him with WebGL and has his moves (`DudeRig.Moves`).

The built files live in `app/sprites/rig.*`. Needs numpy, scipy, scikit-image and Pillow.
