/**
 * Embedded Sample Datasets for Roadway Line-to-Line Overlay Tool.
 * Enables 100% offline and static deployment without backend servers.
 */

window.SAMPLE_TARGET_DATA = {
  "type": "FeatureCollection",
  "name": "Sample Bottlenecks (Target)",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "Segment_ID": "BN-101",
        "Roadway": "I-4 Westbound",
        "Head_Location": "I-4 W @ SR-434 / EXIT 94",
        "Total_Delay_Min": 3450000.0,
        "AADT": 142000
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.4245, 28.6750],
          [-81.4350, 28.6680],
          [-81.4480, 28.6590],
          [-81.4620, 28.6490]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "Segment_ID": "BN-102",
        "Roadway": "I-4 Eastbound",
        "Head_Location": "I-4 E @ SR-436 / ALTAMONTE",
        "Total_Delay_Min": 2890000.0,
        "AADT": 138000
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.4400, 28.6500],
          [-81.4260, 28.6600],
          [-81.4120, 28.6700]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "Segment_ID": "BN-103",
        "Roadway": "SR-50 (Colonial Dr)",
        "Head_Location": "SR-50 @ Alafaya Trail",
        "Total_Delay_Min": 1750000.0,
        "AADT": 58000
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.2200, 28.5520],
          [-81.2000, 28.5522],
          [-81.1800, 28.5524]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "Segment_ID": "BN-104",
        "Roadway": "Cross-Street Crossing Line",
        "Head_Location": "Maitland Blvd (Perpendicular Crossing I-4)",
        "Total_Delay_Min": 850000.0,
        "AADT": 42000
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.4450, 28.6250],
          [-81.4400, 28.6450],
          [-81.4350, 28.6650]
        ]
      }
    }
  ]
};

window.SAMPLE_REFERENCE_DATA = {
  "type": "FeatureCollection",
  "name": "Sample Work Program (Reference)",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "ITEMSEG": "4425211",
        "ROADWAY": "I-4 Corridor",
        "PHASE": "CON",
        "FISCAL_YR": 2026,
        "high_yr_ph": "CON 2026",
        "DESC": "I-4 Beyond the Ultimate Capacity Improvements"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.4200, 28.6780],
          [-81.4340, 28.6690],
          [-81.4470, 28.6600],
          [-81.4650, 28.6470]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "ITEMSEG": "4425211",
        "ROADWAY": "I-4 Corridor Auxiliary Lanes",
        "PHASE": "PE",
        "FISCAL_YR": 2025,
        "high_yr_ph": "PE 2025",
        "DESC": "I-4 Auxiliary Lane Preliminary Engineering"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.4300, 28.6720],
          [-81.4450, 28.6610],
          [-81.4600, 28.6500]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "ITEMSEG": "4398711",
        "ROADWAY": "I-4 Interchange Modification",
        "PHASE": "ROW",
        "FISCAL_YR": 2027,
        "high_yr_ph": "ROW 2027",
        "DESC": "SR-434 Interchange Right of Way Acquisition"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.4220, 28.6770],
          [-81.4320, 28.6700],
          [-81.4420, 28.6630]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "ITEMSEG": "4125331",
        "ROADWAY": "SR-50 Widening",
        "PHASE": "CON",
        "FISCAL_YR": 2028,
        "high_yr_ph": "CON 2028",
        "DESC": "SR-50 4 to 6 lane widening project"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-81.2250, 28.5521],
          [-81.2000, 28.5523],
          [-81.1750, 28.5525]
        ]
      }
    }
  ]
};
