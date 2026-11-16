# FuegoTrazo: Harmonization of MODIS and VIIRS Hot Spots
Analytical framework and web application for tracking historic fire activity with harmonized satellite data.

## Welcome!
This repository contains the source code, methodology, and experimental machine learning models for **FuegoTrazo**. Designed for the NASA Space Apps Challenge 2026, FuegoTrazo resolves the incompatibility between MODIS and VIIRS satellite fire records. By harmonizing historical hotspot data into a unified, comparable metric across Peru, this tool empowers fire managers, researchers, and emergency responders to monitor fire trends, identify critical periods, and generate custom preventive action plans. 

## Prerequisites / Setup Instructions
To run the data processing pipelines and the web application locally, ensure you have the following installed:
* **Python 3.8+**
* **Scikit-Learn** (for the `HistGradientBoostingClassifier` experimental model)
* **Pandas & SQLite** (for data management and cleaning)
* **R*Tree** (for spatial querying and boundary polygons)
* Basic local web server for the HTML/CSS/JS frontend

## Getting Started
Clone or download the FuegoTrazo repository to explore the data pipeline and web interface[cite: 6].

To clone the repository, type the following in your command line[cite: 6]:
```bash
git clone [https://github.com/Fabryzzio-Meza-Torres/MODIS-VIIRS-Harmonization.git](https://github.com/Fabryzzio-Meza-Torres/MODIS-VIIRS-Harmonization.git)
