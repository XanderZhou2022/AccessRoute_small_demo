# Demo location selection

Selection followed actual data acquisition. No building name appears in the routing core or renderers; scene-specific choices exist in the acquisition/build configuration only.

| Candidate       | Levels | Units | Openings | Amenities | Lift points | Nearest station (centroid distance) |
| --------------- | -----: | ----: | -------: | --------: | ----------: | ----------------------------------- |
| Hysan Place     |     48 |  2525 |     2354 |      2235 |         332 | Causeway Bay, 15m                   |
| Maritime square |     36 |  2363 |     2779 |      2620 |         133 | Tsing Yi, 20m                       |
| PopCorn 1       |     11 |  4113 |     3272 |      3535 |         184 | Tseung Kwan O, 66m                  |
| PopCorn 2       |     12 |  1418 |     1461 |      1420 |          70 | Tseung Kwan O, 215m                 |
| 1881 Heritage   |     10 |   370 |      325 |       118 |           6 | Tsim Sha Tsui, 336m                 |
| Telford Plaza   |     11 |  1280 |     1124 |         0 |           0 | Kowloon Bay, 143m                   |

Distances are venue-bounding-box centroid distances and **not walking lengths or accessibility evidence**. Lift points repeat by floor and do not count physical shafts. The simple completeness score in `data/candidates.csv` ranks coverage, not venue suitability by itself.

**Scene A: Hysan Place / Causeway Bay.** G/F and 1/F public indoor geometry supports two connected components with two aligned lift pairs, a small controllable first-leg demo, and nearby MTR indoor data. The selected outdoor API query failed; its short connector is a clearly labeled manual demo augmentation.

**Scene B: PopCorn 2 / Tseung Kwan O.** G/F and 1/F offer two aligned passenger lift pairs, larger public corridor geometry, and a saved successful exterior route baseline. Its lower feature volume than PopCorn 1 makes the offline package simpler. Actual entrance attachment and lift service remain unverified.

Maritime square is a valid future candidate but has more parking / intermediate levels to disambiguate. 1881 has fewer lift points and less redundancy for the same pair of levels. Telford returned no amenity points in the sampled endpoint, so automatic lift semantics would require more manual mapping.

Two cross-region scenes deliberately stress data-driven loading. The middle transit leg is abstract and does not claim a direct MTR connection or a valid interchange plan.
