// Map initialization
const map = L.map('map').setView([32.8, -96.8], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let currentLayer = null;
let precinctsData = [];

// DOM elements
const countySelect = document.getElementById("county");
const jurisdictionSelect = document.getElementById("jurisdiction");
const districtSelect = document.getElementById("district");

// Debug info
console.log("Election Map initialized");

// Populate counties on page load
function loadCounties() {
  fetch("/api/filters")
    .then(res => {
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    })
    .then(counties => {
      console.log("Loaded counties:", counties);
      countySelect.innerHTML = '<option value="">Select County</option>';
      counties.forEach(county => {
        const option = document.createElement("option");
        option.value = county;
        option.textContent = county;
        countySelect.appendChild(option);
      });
      
      // If there's only one county, select it automatically
      if (counties.length === 1) {
        countySelect.value = counties[0];
        countySelect.dispatchEvent(new Event('change'));
      }
    })
    .catch(err => {
      console.error("Failed to load counties:", err);
      alert("Failed to load counties. Check if server is running.");
    });
}

// Load counties when page loads
window.addEventListener('DOMContentLoaded', loadCounties);

// When County changes
countySelect.addEventListener("change", function() {
  const county = this.value;
  console.log("County selected:", county);
  
  // Reset dependent dropdowns
  jurisdictionSelect.innerHTML = '<option value="">Select Jurisdiction</option>';
  jurisdictionSelect.disabled = !county;
  
  districtSelect.innerHTML = '<option value="">Select District</option>';
  districtSelect.disabled = true;
  
  if (county) {
    // Load jurisdictions for selected county
    fetch(`/api/jurisdictions?county=${encodeURIComponent(county)}`)
      .then(res => res.json())
      .then(jurisdictions => {
        console.log("Jurisdictions for", county, ":", jurisdictions);
        jurisdictions.forEach(jurisdiction => {
          const option = document.createElement("option");
          option.value = jurisdiction;
          option.textContent = jurisdiction;
          jurisdictionSelect.appendChild(option);
        });
        jurisdictionSelect.disabled = false;
      })
      .catch(err => console.error("Error loading jurisdictions:", err));
  }
  
  updateMap();
});

// When Jurisdiction changes
jurisdictionSelect.addEventListener("change", function() {
  const county = countySelect.value;
  const jurisdiction = this.value;
  console.log("Jurisdiction selected:", jurisdiction);
  
  // Reset district dropdown
  districtSelect.innerHTML = '<option value="">Select District</option>';
  districtSelect.disabled = !jurisdiction;
  
  if (county && jurisdiction) {
    // Load districts for selected county and jurisdiction
    fetch(`/api/districts?county=${encodeURIComponent(county)}&jurisdiction=${encodeURIComponent(jurisdiction)}`)
      .then(res => res.json())
      .then(districts => {
        console.log("Districts for", county, jurisdiction, ":", districts);
        districts.forEach(district => {
          const option = document.createElement("option");
          option.value = district;
          option.textContent = district;
          districtSelect.appendChild(option);
        });
        districtSelect.disabled = false;
      })
      .catch(err => console.error("Error loading districts:", err));
  }
  
  updateMap();
});

// When District changes
districtSelect.addEventListener("change", updateMap);

// Update map with current filters
function updateMap() {
  const county = countySelect.value;
  const jurisdiction = jurisdictionSelect.value;
  const district = districtSelect.value;
  
  console.log("Updating map with filters:", { county, jurisdiction, district });
  
  // Build query parameters
  const params = new URLSearchParams();
  if (county) params.append('county', county);
  if (jurisdiction) params.append('jurisdiction', jurisdiction);
  if (district) params.append('district', district);
  
  const url = `/api/precincts?${params.toString()}`;
  console.log("Fetching precincts from:", url);
  
  // Show loading state
  if (currentLayer) {
    map.removeLayer(currentLayer);
    currentLayer = null;
  }
  
  // Fetch precincts data
  fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json();
    })
    .then(features => {
      console.log(`Received ${features.length} precinct features`);
      
      if (features.length === 0) {
        console.log("No precincts found for the selected filters");
        map.setView([32.8, -96.8], 9);
        return;
      }
      
      // Store data for reference
      precinctsData = features;
      
      // Create GeoJSON layer
      currentLayer = L.geoJSON(features, {
        style: function(feature) {
          // Color precincts based on filter level
          let color = "#3388ff";
          if (district) color = "#ff3333";      // Red when district selected
          else if (jurisdiction) color = "#33aa33"; // Green when jurisdiction selected
          else if (county) color = "#3388ff";       // Blue when only county selected
          
          return {
            fillColor: color,
            color: "#000",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.4
          };
        },
        onEachFeature: function(feature, layer) {
          // Create popup content
          const props = feature.properties;
          const popupContent = `
            <div style="min-width: 200px;">
              <h4 style="margin: 0 0 10px 0; color: #333;">Precinct ${props.pctkey}</h4>
              <p style="margin: 5px 0;"><strong>County:</strong> ${props.county}</p>
              <p style="margin: 5px 0;"><strong>Jurisdiction:</strong> ${props.jurisdiction}</p>
              <p style="margin: 5px 0;"><strong>District:</strong> ${props.district || 'N/A'}</p>
              <div style="margin-top: 15px; text-align: center;">
                <button onclick="showElectionResults('${props.pctkey}')" 
                        style="background: #3388ff; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">
                  View Election Results
                </button>
              </div>
            </div>
          `;
          
          layer.bindPopup(popupContent);
          
          // Add hover effects
          layer.on('mouseover', function() {
            this.setStyle({
              weight: 3,
              fillOpacity: 0.7
            });
          });
          
          layer.on('mouseout', function() {
            this.setStyle({
              weight: 1,
              fillOpacity: 0.4
            });
          });
          
          // Click to zoom
          layer.on('click', function(e) {
            if (!map.getBounds().contains(e.latlng)) {
              map.setView(e.latlng, map.getZoom());
            }
          });
        }
      }).addTo(map);
      
      // Fit map to bounds of visible features
      const bounds = currentLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
      
      // Update status
      updateStatus(`${features.length} precincts displayed`);
      
    })
    .catch(err => {
      console.error("Error loading precincts:", err);
      updateStatus("Error loading precincts. Check console.");
    });
}

// Show election results for a precinct
window.showElectionResults = function(pctkey) {
  console.log("Fetching results for precinct:", pctkey);
  
  fetch(`/api/results?pctkey=${encodeURIComponent(pctkey)}`)
    .then(res => res.json())
    .then(results => {
      if (results.length === 0) {
        alert(`No election results found for precinct ${pctkey}`);
        return;
      }
      
      // Group results by office
      const resultsByOffice = {};
      results.forEach(result => {
        if (!resultsByOffice[result.office]) {
          resultsByOffice[result.office] = [];
        }
        resultsByOffice[result.office].push(result);
      });
      
      // Create results popup
      let html = `<div style="max-width: 500px; max-height: 400px; overflow-y: auto;">
                   <h3 style="margin-top: 0;">Election Results: Precinct ${pctkey}</h3>`;
      
      Object.keys(resultsByOffice).forEach(office => {
        const officeResults = resultsByOffice[office];
        const totalVotes = officeResults.reduce((sum, r) => sum + parseInt(r.votes), 0);
        
        html += `<div style="margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
                  <h4 style="margin: 0 0 10px 0; color: #555;">${office}</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                      <tr style="background-color: #f5f5f5;">
                        <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Candidate</th>
                        <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Party</th>
                        <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Votes</th>
                        <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">%</th>
                      </tr>
                    </thead>
                    <tbody>`;
        
        officeResults.forEach(result => {
          const percentage = totalVotes > 0 ? ((result.votes / totalVotes) * 100).toFixed(1) : '0.0';
          html += `<tr>
                     <td style="padding: 8px; border: 1px solid #ddd;">${result.candidate}</td>
                     <td style="padding: 8px; border: 1px solid #ddd;">${result.party || 'N/A'}</td>
                     <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${result.votes}</td>
                     <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${percentage}%</td>
                   </tr>`;
        });
        
        html += `</tbody></table>
                 <div style="margin-top: 5px; font-size: 12px; color: #666;">Total votes: ${totalVotes}</div>
               </div>`;
      });
      
      html += `</div>`;
      
      // Open results in a new popup
      L.popup()
        .setLatLng(map.getCenter())
        .setContent(html)
        .openOn(map);
    })
    .catch(err => {
      console.error("Error loading results:", err);
      alert("Error loading election results");
    });
};

// Update status message
function updateStatus(message) {
  let statusDiv = document.getElementById("status");
  if (!statusDiv) {
    statusDiv = document.createElement("div");
    statusDiv.id = "status";
    statusDiv.style.cssText = "position: absolute; top: 10px; right: 10px; background: white; padding: 5px 10px; border-radius: 3px; z-index: 1000; font-size: 12px;";
    document.body.appendChild(statusDiv);
  }
  statusDiv.textContent = message;
  
  // Clear after 5 seconds
  setTimeout(() => {
    if (statusDiv.textContent === message) {
      statusDiv.textContent = "";
    }
  }, 5000);
}

// Add map controls
L.control.scale().addTo(map);

// Initial map update
setTimeout(updateMap, 1000);