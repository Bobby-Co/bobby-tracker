
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyGridinterface = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M7.802 2.5H5.198C3.711 2.5 2.5 3.71 2.5 5.198V7.802C2.5 9.29 3.711 10.5 5.198 10.5H7.802C9.29 10.5 10.5 9.29 10.5 7.802V5.198C10.5 3.71 9.29 2.5 7.802 2.5Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M18.802 13.5H16.198C14.711 13.5 13.5 14.71 13.5 16.198V18.802C13.5 20.29 14.711 21.5 16.198 21.5H18.802C20.29 21.5 21.5 20.29 21.5 18.802V16.198C21.5 14.71 20.29 13.5 18.802 13.5Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M7.802 13.5H5.198C3.711 13.5 2.5 14.71 2.5 16.198V18.802C2.5 20.29 3.711 21.5 5.198 21.5H7.802C9.29 21.5 10.5 20.29 10.5 18.802V16.198C10.5 14.71 9.29 13.5 7.802 13.5Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M14.3381 9.59967C14.5281 9.70667 14.7441 9.76367 14.9611 9.76367H20.2431C20.9361 9.76367 21.5001 9.20067 21.5001 8.50767C21.5001 8.28767 21.4421 8.07167 21.3341 7.88167L18.6941 3.26767C18.3491 2.66667 17.5801 2.45867 16.9811 2.80267C16.7861 2.91267 16.6251 3.07467 16.5131 3.26767L13.8701 7.88167C13.5261 8.48267 13.7341 9.25167 14.3381 9.59967Z" fill={secondColor}></path>
		</svg>
    ) 
}