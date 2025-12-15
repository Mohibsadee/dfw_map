const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const csv = require("csv-parser");
const app = express();
const port =  process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

// Create database
const db = new sqlite3.Database("./db/database.sqlite", (err) => {
  if (err) console.error("Database error:", err);
  else console.log("Database connected");
});

// Clear and recreate tables to ensure fresh data
db.serialize(() => {
  db.run("DROP TABLE IF EXISTS precincts");
  db.run("DROP TABLE IF EXISTS results");
  
  db.run(`CREATE TABLE precincts (
      pctkey TEXT PRIMARY KEY,
      county TEXT,
      jurisdiction TEXT,
      district TEXT,
      geometry TEXT
  )`);
  
  db.run(`CREATE TABLE results (
      pctkey TEXT,
      office TEXT,
      candidate TEXT,
      votes INTEGER,
      party TEXT
  )`);
  
  console.log("Tables created");
});

// Import CSV into results table
let resultsCount = 0;
fs.createReadStream("./data/DFWResult(1).csv")
  .pipe(csv())
  .on("data", (row) => {
    db.run(
      `INSERT INTO results (pctkey, office, candidate, votes, party) VALUES (?, ?, ?, ?, ?)`,
      [row.pctkey, row.office, row.candidate, row.votes, row.party_simplified],
      (err) => {
        if (err) console.error("Error inserting result:", err);
      }
    );
    resultsCount++;
  })
  .on("end", () => {
    console.log(`Results CSV imported: ${resultsCount} records`);
  });

// Import GeoJSON into precincts table - FIXED WITH CORRECT PROPERTIES
let precinctsCount = 0;
try {
  const precinctsGeo = JSON.parse(fs.readFileSync("./data/GDF.geojson", "utf8"));
  console.log(`Loaded GeoJSON with ${precinctsGeo.features.length} features`);
  
  // Check what properties are available
  if (precinctsGeo.features.length > 0) {
    console.log("Sample properties:", precinctsGeo.features[0].properties);
  }
  
  const stmt = db.prepare(`
    INSERT INTO precincts (pctkey, county, jurisdiction, district, geometry) 
    VALUES (?, ?, ?, ?, ?)
  `);
  
  precinctsGeo.features.forEach((feat, index) => {
    const props = feat.properties;
    
    // Map GeoJSON properties to database columns
    const pctkey = props.pctkey || `precinct_${index}`;
    const county = props.county || "Unknown";
    const jurisdiction = props.city || "Unknown";
    const district = props.us_congress || props.state_senate || props.state_house || "Unknown";
    const geometry = JSON.stringify(feat.geometry);
    
    stmt.run(pctkey, county, jurisdiction, String(district), geometry, (err) => {
      if (err && err.code !== "SQLITE_CONSTRAINT") {
        console.error(`Error inserting precinct ${pctkey}:`, err.message);
      }
    });
    
    precinctsCount++;
    
    // Log progress
    if (index % 1000 === 0) {
      console.log(`Imported ${index} precincts...`);
    }
  });
  
  stmt.finalize(() => {
    console.log(`GeoJSON imported: ${precinctsCount} precincts`);
    
    // Verify data after import
    db.all("SELECT COUNT(*) as count FROM precincts", [], (err, row) => {
      if (!err) console.log(`Total precincts in database: ${row[0].count}`);
    });
    
    db.all("SELECT county, COUNT(*) as count FROM precincts GROUP BY county", [], (err, rows) => {
      if (!err) {
        console.log("Counties in database:");
        rows.forEach(r => console.log(`  ${r.county}: ${r.count} precincts`));
      }
    });
  });
  
} catch (err) {
  console.error("Error loading GeoJSON:", err);
}

// API endpoints

// 1️⃣ County filters
app.get("/api/filters", (req, res) => {
  db.all("SELECT DISTINCT county FROM precincts WHERE county IS NOT NULL ORDER BY county", [], (err, counties) => {
    if (err) {
      console.error("Error fetching counties:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json(counties.map(c => c.county));
  });
});

// 2️⃣ Jurisdictions based on county
app.get("/api/jurisdictions", (req, res) => {
  const { county } = req.query;
  
  if (!county || county === "Select County") {
    return res.json([]);
  }
  
  db.all(
    "SELECT DISTINCT jurisdiction FROM precincts WHERE county=? AND jurisdiction IS NOT NULL ORDER BY jurisdiction",
    [county],
    (err, rows) => {
      if (err) {
        console.error("Error fetching jurisdictions:", err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows.map(r => r.jurisdiction));
    }
  );
});

// 3️⃣ Districts based on county + jurisdiction
app.get("/api/districts", (req, res) => {
  const { county, jurisdiction } = req.query;
  
  if (!county || !jurisdiction || county === "Select County" || jurisdiction === "Select Jurisdiction") {
    return res.json([]);
  }
  
  db.all(
    "SELECT DISTINCT district FROM precincts WHERE county=? AND jurisdiction=? AND district IS NOT NULL ORDER BY district",
    [county, jurisdiction],
    (err, rows) => {
      if (err) {
        console.error("Error fetching districts:", err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows.map(r => r.district));
    }
  );
});

// 4️⃣ Get precincts by filters - MAIN MAP ENDPOINT
app.get("/api/precincts", (req, res) => {
  const { county, jurisdiction, district } = req.query;

  let query = "SELECT pctkey, county, jurisdiction, district, geometry FROM precincts WHERE 1=1";
  let params = [];

  if (county && county !== "Select County") { 
    query += " AND county = ?"; 
    params.push(county); 
  }
  if (jurisdiction && jurisdiction !== "Select Jurisdiction") { 
    query += " AND jurisdiction = ?"; 
    params.push(jurisdiction); 
  }
  if (district && district !== "Select District") { 
    query += " AND district = ?"; 
    params.push(district); 
  }
  
  console.log(`Fetching precincts with query: ${query}`, params);
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error("Error fetching precincts:", err);
      return res.status(500).json({ error: err.message });
    }
    
    const features = rows.map(row => ({
      type: "Feature",
      properties: {
        pctkey: row.pctkey,
        county: row.county,
        jurisdiction: row.jurisdiction,
        district: row.district
      },
      geometry: JSON.parse(row.geometry)
    }));
    
    console.log(`Returning ${features.length} precincts`);
    res.json(features);
  });
});

// 5️⃣ Get results by pctkey
app.get("/api/results", (req, res) => {
  const { pctkey } = req.query;
  
  db.all("SELECT * FROM results WHERE pctkey=?", [pctkey], (err, rows) => {
    if (err) {
      console.error("Error fetching results:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 6️⃣ Test endpoint to check database
app.get("/api/debug", (req, res) => {
  db.all("SELECT county, jurisdiction, district, COUNT(*) as count FROM precincts GROUP BY county, jurisdiction, district LIMIT 20", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ 
      precinctCount: rows.length,
      sampleData: rows,
      database: "./db/database.sqlite"
    });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Visit http://localhost:${port}/api/debug to check database`);
});
