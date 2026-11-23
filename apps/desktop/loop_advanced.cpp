#include <iostream>
#include <vector>
#include <map>
#include <algorithm>

int main() {
    std::map<std::string, std::vector<int>> data = {
        {"A", {1, 2, 3}},
        {"B", {4, 5}},
        {"C", {6, 7, 8, 9}}
    };

    // Vòng lặp cao cấp: in key, tổng giá trị, và các số chẵn
    for (const auto& [key, values] : data) {
        int sum = 0;
        std::for_each(values.begin(), values.end(), [&](int v) { sum += v; });
        std::cout << key << ": sum=" << sum << ", even={";
        for (int v : values)
            if (v % 2 == 0) std::cout << v << " ";
        std::cout << "}\n";
    }
}