---
"@openfilm/desktop": patch
---

Chat: when an agent's turn ends with film.html gone, its reply says so and offers one click: "Restore film.html as it was before this turn". It puts back the film the turn started from, and never writes over a film.html that came back meanwhile. A turn that deletes film.html and writes it again offers nothing. (#304)
